export class CacheKeys {
  static authMe(userId: string): string {
    return `auth:me:${userId}`;
  }

  static user(userId: string): string {
    return `user:${userId}`;
  }

  static userProfile(userId: string): string {
    return `user:profile:${userId}`;
  }

  static vet(vetId: string): string {
    return `vet:${vetId}`;
  }

  static vendor(vendorId: string): string {
    return `vendor:${vendorId}`;
  }

  static wallet(userId: string): string {
    return `wallet:${userId}`;
  }

  // ── Marketplace ──────────────────────────────────────────────────────────

  /** Full active listings catalog — public, high-read */
  static listings(): string {
    return 'marketplace:listings';
  }

  /** Single listing detail by id or slug */
  static listing(idOrSlug: string): string {
    return `marketplace:listing:${idOrSlug}`;
  }

  // ── Vet Directory ─────────────────────────────────────────────────────────

  /**
   * Vet directory filtered by a stable, sorted query-string fingerprint.
   * e.g. CacheKeys.vetsList('availableOnly=true&minRating=4')
   */
  static vetsList(fingerprint: string): string {
    return `vets:list:${fingerprint || 'all'}`;
  }

  /** Public vet profile by id or slug */
  static vetProfile(idOrSlug: string): string {
    return `vets:profile:${idOrSlug}`;
  }
}
