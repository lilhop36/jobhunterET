import { IsOptional, IsString, MaxLength } from 'class-validator';

export class SubmitApplicationDto {
  /** The hash of the approved revision the candidate is submitting. */
  @IsString()
  contentHash: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class ConfirmSubmissionDto {
  /** Employer reference, confirmation number, or message id, if any. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}