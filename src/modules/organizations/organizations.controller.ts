import { Controller, Post, Body, Get, Param } from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import { OrganizationMembersService } from './services/organization-members.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { AddMemberDto } from './dto/add-member.dto';
import { CurrentUser } from '../identity/auth/decorators/current-user.decorator';

@Controller('organizations')
export class OrganizationsController {
  constructor(
    private readonly orgService: OrganizationsService,
    private readonly orgMembersService: OrganizationMembersService,
  ) {}

  @Post()
  async createOrganization(
    @CurrentUser() user: any,
    @Body() dto: CreateOrganizationDto,
  ) {
    return this.orgService.createOrganization(user.id, dto);
  }

  @Get('my-orgs')
  async getMyOrganizations(@CurrentUser() user: any) {
    return this.orgService.getUserOrganizations(user.id);
  }

  @Post(':id/members')
  async addMember(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() dto: AddMemberDto,
  ) {
    return this.orgMembersService.addMember(user.id, id, dto);
  }
}
