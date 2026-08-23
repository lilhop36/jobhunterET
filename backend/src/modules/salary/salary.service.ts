import { Injectable } from '@nestjs/common';
import {
  compareSalary,
  lookupBenchmark,
  BENCHMARKS,
  USD_TO_ETB,
  type BenchmarkResult,
} from './salary-benchmarks';

@Injectable()
export class SalaryService {
  /**
   * Get benchmark for a specific role and level.
   */
  getBenchmark(role: string, level: string) {
    return lookupBenchmark(role, level);
  }

  /**
   * Compare a job's salary against market benchmarks.
   */
  compareJobSalary(
    salary: number | null,
    currency: string,
    jobTitle: string,
    experienceLevel: string,
  ) {
    // Always get the benchmark data first
    const lookup = lookupBenchmark(jobTitle, experienceLevel);
    const roleBenchmark = lookup.benchmark; // RoleBenchmark | null

    if (salary == null) {
      return {
        hasSalary: false,
        benchmark: roleBenchmark,
        comparison: null,
      };
    }

    const result = compareSalary(salary, currency, jobTitle, experienceLevel);

    return {
      hasSalary: true,
      salary,
      currency,
      benchmark: result.benchmark,
      percentile: result.jobSalaryPercentile,
      comparison: result.comparison,
      percentAboveMedian: result.percentAbove,
    };
  }

  /**
   * Get all available benchmarks (for the admin/settings view).
   */
  getAllBenchmarks() {
    return BENCHMARKS.map((b) => ({
      role: b.role,
      level: b.level,
      etb: b.etb,
      usd: b.usd,
      notes: b.notes,
    }));
  }

  /**
   * Get the current FX rate used for conversions.
   */
  getFxRate() {
    return { usdToEtb: USD_TO_ETB, note: 'Approximate rate — update periodically' };
  }
}
