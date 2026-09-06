# Arquitectura — Zcash Meme Launchpad (MVP tipo SHLD.fun)

## Decisión de diseño

**Modelo de custodia:** custodial simple, como SHLD.fun. El backend controla una
wallet Zcash caliente (la "reserva") que recibe todo el ZEC de compras y paga
todo el ZEC de ventas. Los balances de tokens son filas en Postgres, no
activos on-chain — Zcash no tiene VM, así que no hay otra forma de tener
"tokens" sin un meta-protocolo mucho más complejo (ver alternativas abajo).

**Riesgo que esto implica (dejarlo escrito, no ocultarlo):** quien controla la
clave de la wallet de reserva controla la plata de todos los usuarios. No hay
contrato que la bloquee. Esto es funcionalmente una casa de cambio custodial,
no un protocolo descentralizado — el mismo perfil de riesgo que SHLD.fun,
distinto al de Arrow (donde el contrato en la EVM es el que manda).

**Infra de detección de pagos:** light client (zingo-cli / zingolib) apuntando
a un lightwalletd público de mainnet, en vez de correr un nodo zebrad propio.
Razón: para un MVP no vale la pena operar infraestructura de nodo completo;
un light client con la Incoming Viewing Key de la wallet de reserva alcanza
para generar direcciones diversificadas por orden y detectar pagos entrantes
vía trial-decryption de compact blocks (ZIP-307). Si el volumen lo justifica
más adelante, se migra a nodo propio para no depender de un tercero.

## Flujo de compra

1. Usuario crea/entra a su "wallet SHLD" (cuenta interna, 12 palabras =
   login, no un keypair de Zcash real — igual que SHLD.fun).
2. Elige token + monto en ZEC a pagar.
3. Backend pide al zcash-service una **dirección diversificada nueva**
   (misma viewing key de la reserva, dirección distinta por orden) y crea una
   `Order` en estado `pending`.
4. Frontend muestra QR + URI de pago (ZIP-321) con esa dirección.
5. Usuario paga desde su wallet real (Zashi/Ywallet/Zingo/Zodl).
6. zcash-service detecta el pago (poll de compact blocks + IVK), confirma
   monto y bloque, y notifica al backend.
7. Backend calcula el precio de ejecución sobre la bonding curve al momento
   de la confirmación, acredita tokens en el balance interno del comprador,
   y marca la orden como `filled`.
8. Si el market cap del token cruza el umbral de graduación, se marca
   `graduated` (fase futura: mover la reserva a un pool de verdad).

Venta: mismo camino al revés — se debita el balance interno y el backend
paga ZEC a la dirección de refund que el usuario indique.

## Componentes

```
zcash-launchpad/
  backend/        API (Fastify + TS), Prisma/Postgres, lógica de bonding curve y ledger
  zcash-service/  Wrapper del light client Zcash (genera direcciones, detecta pagos, envía pagos)
  frontend/       Next.js, UI estilo SHLD.fun (Market / Create / Portfolio)
  docs/           Este documento y notas de research
```

## Lo que falta para tocar ZEC real (no incluido en este scaffold)

- Binario de zingo-cli/zingolib compilado y una wallet de reserva real
  generada y respaldada de forma segura (HSM o al menos un seed offline,
  nunca en el mismo server que la API pública).
- Endpoint de lightwalletd de mainnet confiable (o nodo propio).
- Política de reservas: cuánto ZEC mantener líquido vs. en frío.
- Marco legal: este producto es funcionalmente una plataforma de custodia de
  fondos de terceros. Vale la pena que lo mires con un abogado antes de
  lanzarlo con plata real — el mismo disclaimer que usa SHLD.fun
  ("independent project, not affiliated with ECC/ZF") no te exime de nada
  frente a un usuario que pierda plata.

## Alternativas consideradas (para más adelante, no para el MVP)

- **Meta-protocolo on-chain (tipo ZPAD-20 / zRunes):** operaciones
  deploy/mint/buy/sell escritas en memos shielded, un indexador reconstruye
  el estado global. Más verificable, mucho más trabajo, sigue sin ser
  trustless sin PCZT.
- **Zcash solo como riel de pago privado:** la compra se paga en ZEC shielded
  pero el token real se emite en una chain con smart contracts (ej.
  integrado a Arrow en una de tus EVM). Resuelve el problema de custodia del
  token en sí, pero la plata que entra sigue pasando por una wallet que vos
  controlás en algún punto de la conversión.
