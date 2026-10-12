import { PrismaClient } from '@prisma/client';


const prisma = new PrismaClient();


async function main() {
  const perfStart = performance.now();
  const tables = await prisma.$queryRaw`
    SELECT *
    FROM "OutboxEvent"
    WHERE "published" = true
    ORDER BY "createdAt" ASC
    LIMIT 100
    `;
  
  
  const perfEnd = performance.now();
  
  
  
  console.log(`Latency: ${perfEnd-perfStart}ms`, tables);
}



main()