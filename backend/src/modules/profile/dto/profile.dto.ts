import { IsOptional, IsString, IsInt, IsArray, IsBoolean, MaxLength } from 'class-validator';

export interface EducationInput {
  institution: string;
  degree?: string;
  field?: string;
  startYear?: number | null;
  endYear?: number | null;
  grade?: string;
}

export interface ExperienceInput {
  title: string;
  company: string;
  location?: string;
  startYear?: number | null;
  endYear?: number | null;
  current?: boolean;
  description?: string;
}

export interface ProjectInput {
  name: string;
  description?: string;
  url?: string;
  year?: number | null;
}

export interface CertificationInput {
  name: string;
  issuer?: string;
  year?: number | null;
  credentialUrl?: string;
}

export interface LanguageInput {
  language: string;
  proficiency?: 'NATIVE' | 'FLUENT' | 'INTERMEDIATE' | 'BASIC';
}

export class UpdateProfileDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() summary?: string;
  @IsOptional() @IsInt() years?: number;
  @IsOptional() @IsBoolean() remote?: boolean;
  @IsOptional() @IsInt() minSalary?: number;
  @IsOptional() @IsBoolean() excludeOnsite?: boolean;
  @IsOptional() @IsBoolean() excludeEntryLevel?: boolean;
  @IsOptional() @IsArray() @IsString({ each: true }) skills?: string[];
  @IsOptional() @IsArray() targetRoles?: { role: string; priority: 'HIGH' | 'MEDIUM' | 'LOW' }[];
  @IsOptional() @IsArray() locationTiers?: { region: string; tier: 'HIGH' | 'MEDIUM' | 'LOW' }[];
  @IsOptional() @IsArray() @IsString({ each: true }) employmentTypes?: string[];
  @IsOptional() @IsBoolean() onboardDone?: boolean;

  // Personal details
  @IsOptional() @IsString() @MaxLength(120) fullName?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsString() @MaxLength(80) city?: string;
  @IsOptional() @IsString() @MaxLength(80) country?: string;
  @IsOptional() @IsString() @MaxLength(300) linkedinUrl?: string;
  @IsOptional() @IsString() @MaxLength(300) githubUrl?: string;
  @IsOptional() @IsString() @MaxLength(300) portfolioUrl?: string;

  // Structured sections — each replaces the stored rows when present
  @IsOptional() @IsArray() education?: EducationInput[];
  @IsOptional() @IsArray() experiences?: ExperienceInput[];
  @IsOptional() @IsArray() projects?: ProjectInput[];
  @IsOptional() @IsArray() certifications?: CertificationInput[];
  @IsOptional() @IsArray() languages?: LanguageInput[];

  /** Core matching attributes — changing any of these triggers recalc (FR-003e). */
  static CORE_KEYS = ['skills', 'targetRoles', 'locationTiers', 'remote', 'employmentTypes', 'excludeEntryLevel'] as const;
}
