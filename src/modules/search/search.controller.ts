import { Controller, Get, Query } from '@nestjs/common';
import { SearchService } from './search.service';
import { Public } from '../identity/auth/decorators/public.decorator';
import { Throttle } from '@nestjs/throttler';

@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Get()
  async search(@Query('q') q?: string) {
    if (!q || q.trim() === '') {
      return this.searchService.getRecentOrFeatured();
    }
    return this.searchService.searchAll(q);
  }
}
