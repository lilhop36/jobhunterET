import { Controller, Get, Query } from '@nestjs/common';
import { SalaryService } from './salary.service';

@Controller('salary')
export class SalaryController {
  constructor(private readonly salary: SalaryService) {}

  /**
   * GET /api/salary/benchmark?role=Backend Developer&level=MID
   */
  @Get('benchmark')
  getBenchmark(@Query('role') role: string, @Query('level') level: string) {
    return this.salary.getBenchmark(role || '', level || 'MID');
  }

  /**
   * GET /api/salary/compare?salary=50000&currency=ETB&title=Backend Developer&level=MID
   */
  @Get('compare')
  compare(
    @Query('salary') salary: string,
    @Query('currency') currency: string,
    @Query('title') title: string,
    @Query('level') level: string,
  ) {
    const num = salary ? parseInt(salary, 10) : null;
    return this.salary.compareJobSalary(num, currency || 'ETB', title || '', level || 'MID');
  }

  /**
   * GET /api/salary/benchmarks — all available benchmarks.
   */
  @Get('benchmarks')
  getAll() {
    return this.salary.getAllBenchmarks();
  }

  /**
   * GET /api/salary/fx — current FX rate.
   */
  @Get('fx')
  getFx() {
    return this.salary.getFxRate();
  }
}
