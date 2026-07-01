import { Injectable, UnauthorizedException, ConflictException, Logger } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { PrismaService } from '../../../../infra/prisma/prisma.service';
import { HashingService } from './services/hash.service';
import { TokenService } from './services/token.service';
import { generateSlug, uniqueSlug } from '../../../../common/utils/slug';
import { randomUUID } from 'crypto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
    private readonly hashingService: HashingService,
  ) {}

  async register(registerDto: RegisterDto, context?: { ip?: string; ua?: string }) {
    const existingUser = await this.usersService.findByEmail(registerDto.email);
    if (existingUser) {
      throw new ConflictException('User with this email already exists');
    }

    const hashedPassword = await this.hashingService.hash(registerDto.password);

    // Pre-generate unique slugs outside the transaction to avoid nested async issues
    const fullName = `${registerDto.firstName} ${registerDto.lastName}`;
    const baseSlug = generateSlug(fullName);

    let vetSlug: string | undefined;
    if (registerDto.vetProfile) {
      vetSlug = await uniqueSlug(baseSlug, async (s) => {
        const exists = await this.prisma.vetProfile.findUnique({ where: { slug: s } });
        return !!exists;
      });
    }

    let vendorSlug: string | undefined;
    if (registerDto.vendorProfile) {
      vendorSlug = await uniqueSlug(baseSlug, async (s) => {
        const exists = await this.prisma.vendorProfile.findUnique({ where: { slug: s } });
        return !!exists;
      });
    }

    // Run within a Prisma transaction
    const user = await this.prisma.$transaction(async (tx) => {
      // Create Base User
      const newUser = await tx.user.create({
        data: {
          email: registerDto.email,
          passwordHash: hashedPassword,
          phone: registerDto.phone,
          firstName: registerDto.firstName,
          lastName: registerDto.lastName,
          displayName: registerDto.displayName,
          ...(registerDto.vetProfile && {
            vetProfile: {
              create: {
                licenseNumber: registerDto.vetProfile.licenseNumber,
                licenseCountry: registerDto.vetProfile.licenseCountry || 'Nigeria',
                licenseDocUrl: registerDto.vetProfile.licenseDocUrl || '',
                specialization: registerDto.vetProfile.specialization || 'GENERAL_PRACTICE',
                experience: registerDto.vetProfile.experience,
                bio: registerDto.vetProfile.bio,
                slug: vetSlug,
              },
            },
          }),
          ...(registerDto.vendorProfile && {
            vendorProfile: {
              create: {
                businessName: registerDto.vendorProfile.businessName,
                businessPhone: registerDto.vendorProfile.businessPhone,
                businessAddress: registerDto.vendorProfile.businessAddress,
                bio: registerDto.vendorProfile.bio,
                slug: vendorSlug,
              },
            },
          }),
        },
        include: {
          vetProfile: true,
          vendorProfile: true,
        },
      }) as any;

      // Insert Outbox Event (MANDATORY EVENT-DRIVEN PATTERN)
      await tx.outboxEvent.create({
        data: {
          type: 'USER_REGISTERED',
          payload: {
            userId: newUser.id,
            email: newUser.email,
            hasVetProfile: !!newUser.vetProfile,
            hasVendorProfile: !!newUser.vendorProfile,
          },
        },
      });

      return newUser;
    });

    const { passwordHash, ...result } = user;
    const tokens = await this.tokenService.issueAuthTokens(result.id, result.email, context);
    
    return {
      user: result,
      tokens,
    };
  }

  async login(loginDto: LoginDto, context?: { ip?: string; ua?: string }) {
    const user = await this.usersService.findByEmail(loginDto.email);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.passwordHash) {
      throw new UnauthorizedException(
        "This account currently uses Google Sign-In. Add a password from your account security settings if you'd like to sign in with email and password."
      );
    }

    const isPasswordValid = await this.hashingService.verify(user.passwordHash, loginDto.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const { passwordHash, ...result } = user;
    const tokens = await this.tokenService.issueAuthTokens(result.id, result.email, context);

    return {
      user: result,
      tokens,
    };
  }
  
  async refresh(token: string, context?: { ip?: string; ua?: string }){
    return this.tokenService.issueFreshAuthTokens(token, context);
  }

  async checkEmail(email: string) {
    const user = await this.usersService.findByEmail(email);
    return {
      exists: !!user,
      hasVetProfile: !!user?.vetProfile,
      hasVendorProfile: !!user?.vendorProfile,
    };
  }

  async verifyPassword(email: string, password: string): Promise<boolean> {
    const user = await this.usersService.findByEmail(email);
    if (!user || !user.passwordHash) {
      return false;
    }
    return this.hashingService.verify(user.passwordHash, password);
  }

  async logout(token: string) {
    await this.tokenService.revokeSession(token);
  }

  async linkVetProfile(email: string, password: string, vetData: any) {
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const isPasswordValid = user.passwordHash ? await this.hashingService.verify(user.passwordHash, password) : false;
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.vetProfile) {
      throw new ConflictException('User already has a veterinarian profile');
    }

    return this.prisma.$transaction(async (tx) => {
      const vetProfile = await tx.vetProfile.create({
        data: {
          userId: user.id,
          licenseNumber: vetData.licenseNumber,
          licenseCountry: vetData.licenseCountry || 'Nigeria',
          licenseDocUrl: vetData.licenseDocUrl || '',
          specialization: vetData.specialization || 'GENERAL_PRACTICE',
          experience: vetData.experience,
          bio: vetData.bio,
        },
      });

      await tx.outboxEvent.create({
        data: {
          type: 'VET_PROFILE_LINKED',
          payload: {
            userId: user.id,
            email: user.email,
            vetProfileId: vetProfile.id,
            licenseNumber: vetProfile.licenseNumber,
          },
        },
      });

      return vetProfile;
    });
  }

  async linkVendorProfile(email: string, password: string, vendorData?: any) {
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const isPasswordValid = user.passwordHash ? await this.hashingService.verify(user.passwordHash, password) : false;
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.vendorProfile) {
      throw new ConflictException('User already has a vendor profile');
    }

    return this.prisma.$transaction(async (tx) => {
      const vendorProfile = await tx.vendorProfile.create({
        data: {
          userId: user.id,
          businessName: vendorData?.businessName,
          businessPhone: vendorData?.businessPhone,
          businessAddress: vendorData?.businessAddress,
          bio: vendorData?.bio,
        },
      });

      await tx.outboxEvent.create({
        data: {
          type: 'VENDOR_PROFILE_LINKED',
          payload: {
            userId: user.id,
            email: user.email,
            vendorProfileId: vendorProfile.id,
            businessName: vendorProfile.businessName,
          },
        },
      });

      return vendorProfile;
    });
  }

  async validateOrCreateGoogleUser(googleUser: {
    email: string;
    firstName: string;
    lastName: string;
    avatarUrl?: string;
  }) {
    let user = await this.usersService.findByEmail(googleUser.email);

    if (!user) {
      try {
        const displayName = `${googleUser.firstName} ${googleUser.lastName}`;
        user = await this.prisma.$transaction(async (tx) => {
          const newUser = await tx.user.create({
            data: {
              email: googleUser.email,
              passwordHash: null,
              firstName: googleUser.firstName,
              lastName: googleUser.lastName,
              displayName: displayName,
              avatarUrl: googleUser.avatarUrl,
            },
          });

          // Insert Outbox Event (MANDATORY EVENT-DRIVEN PATTERN)
          await tx.outboxEvent.create({
            data: {
              type: 'USER_REGISTERED',
              payload: {
                userId: newUser.id,
                email: newUser.email,
                hasVetProfile: false,
                hasVendorProfile: false,
              },
            },
          });

          return newUser as any;
        });
      } catch (error: any) {
        // Concurrency safety: catch unique constraint exception P2002
        if (error.code === 'P2002') {
          user = await this.usersService.findByEmail(googleUser.email);
          if (!user) {
            throw error;
          }
        } else {
          throw error;
        }
      }
    }

    return user;
  }

  async issueAuthTokens(userId: string, email: string, context?: { ip?: string; ua?: string }) {
    return this.tokenService.issueAuthTokens(userId, email, context);
  }
}

