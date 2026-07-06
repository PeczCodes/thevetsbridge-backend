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
}
