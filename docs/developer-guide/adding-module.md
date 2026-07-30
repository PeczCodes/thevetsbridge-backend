# Guide: Adding a New Module

This guide provides a step-by-step workflow for extending the VetsBridge API with a new domain module.

---

## Step 1: Create Module Directory Structure

Under `src/modules/<module-name>`, create:
```
src/modules/pet-insurance/
├── dto/
│   └── create-insurance.dto.ts
├── pet-insurance.controller.ts
├── pet-insurance.module.ts
└── pet-insurance.service.ts
```

---

## Step 2: Define DTOs with Class-Validator

```ts
import { IsString, IsNotEmpty, IsNumber, Min } from 'class-validator';

export class CreateInsuranceDto {
  @IsString()
  @IsNotEmpty()
  policyName: string;

  @IsNumber()
  @Min(0)
  annualPremium: number;
}
```

---

## Step 3: Implement Business Service

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../infra/prisma/prisma.service';

@Injectable()
export class PetInsuranceService {
  constructor(private readonly prisma: PrismaService) {}

  async createPolicy(userId: string, dto: any) {
    // Implement domain logic using Prisma
  }
}
```

---

## Step 4: Implement Controller with Auth & Role Guards

```ts
import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { PetInsuranceService } from './pet-insurance.service';
import { JwtAuthGuard } from '../identity/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../identity/auth/guards/roles.guard';
import { Roles } from '../identity/auth/decorators/roles.decorator';
import { CurrentUser } from '../identity/auth/decorators/current-user.decorator';

@Controller('pet-insurance')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PetInsuranceController {
  constructor(private readonly insuranceService: PetInsuranceService) {}

  @Roles('CUSTOMER')
  @Post()
  async create(@CurrentUser() user: any, @Body() dto: any) {
    return this.insuranceService.createPolicy(user.id, dto);
  }
}
```

---

## Step 5: Register Module in `app.module.ts`

Import and add `PetInsuranceModule` to the `imports` array in `src/app.module.ts`.
