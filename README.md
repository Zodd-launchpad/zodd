# Zcash meme launchpad — MVP demo (clon de SHLD.fun)

Ver `docs/ARCHITECTURE.md` para la explicación completa de cómo funciona
SHLD.fun, las decisiones de arquitectura tomadas acá, y qué falta para
tocar ZEC real.

## Cómo correrlo

Necesitás dos terminales:

```
cd backend && npm install && npm run dev     # API en :8787 (ledger en memoria)
cd frontend && npm install && npm run dev    # UI en :3000
```

Abrí http://localhost:3000. Todo el pago/confirmación de Zcash está
MOCKEADO (ver `backend/src/lib/zcashMock.ts`) — no hace falta ZEC real ni
un nodo Zcash para probar el flujo completo (crear wallet → crear token →
comprar → ver portfolio).

## Qué es real y qué es demo

- **Real / production-ready en su forma:** la matemática de la bonding
  curve (`backend/src/lib/bondingCurve.ts`, con tests), el modelo de datos
  (`backend/prisma/schema.prisma`), la estructura de la API.
- **Mock, a propósito:** la detección de pagos Zcash y el envío de payouts
  (`backend/src/lib/zcashMock.ts`), el ledger en memoria en vez de Postgres
  (`backend/src/lib/store.ts`), la wallet interna en localStorage.

Antes de mover ZEC real hace falta reemplazar `zcashMock.ts` por una
integración real (zingo-cli/zingolib contra un lightwalletd de mainnet) y
pasar el store en memoria a Postgres vía el schema de Prisma ya escrito.
Ver el detalle en `docs/ARCHITECTURE.md`.
