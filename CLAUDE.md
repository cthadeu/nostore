# nostore — guia para o Claude Code

Plataforma de venda por checkout individual: o vendedor cadastra um produto (físico ou um pacote de arquivos digitais), compartilha o link e recebe pelo Mercado Pago; o comprador paga sem cadastro e recebe entrega e links por e-mail. Regras de negócio: `SPEC.md`. Vocabulário obrigatório nos textos e no código: `CONTEXT.md`. Operação local (Docker, Mailpit, ClamAV): `README.md`.

## Estrutura

- Monorepo npm workspaces. `apps/api`: Fastify 5 + Prisma 7 (adapter pg) + PostgreSQL, TypeScript executado nativamente pelo Node 24 (`erasableSyntaxOnly`, imports com extensão `.ts`). `apps/web`: React 19 + Vite + HeroUI v3 + SWR, textos em português.
- API: `src/server.ts` (entrypoint) → `src/build-app.ts` (plugins, hooks, rotas) → `src/modules/*` (auth, seller, assets, commerce, gateway, webhooks) → `src/lib/*` (config, domain, security, commerce, payments, gateway, mercadopago, mp-account, storage, mailer, mail-template, scanner, pdf-stamp).
- Prisma: schema em `apps/api/prisma/schema.prisma`, client gerado em `apps/api/src/generated/prisma` (ignorado no git, gerado no build).

## Comandos

- `npm run setup` cria `.env`; `npm run dev` sobe api, web e worker; `npm run typecheck` (todos os workspaces); `npm run build`.
- Testes: `npm test -w @nostore/api`. Exigem `TEST_DATABASE_URL` com sufixo `_test`; os arquivos rodam em série (`--test-concurrency=1`) porque compartilham o banco. Com Node 22 use `NODE_OPTIONS=--experimental-strip-types`; o projeto pede Node 24.
- Banco: `npm run db:generate`, `npm run db:migrate` (aplica `prisma migrate deploy` com o `.env`). Não há shadow DB nem `migrate dev`: para criar uma migração, edite o schema, gere o SQL com `DATABASE_URL=<banco com schema atual> node ../../node_modules/prisma/build/index.js migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`, salve em `prisma/migrations/<timestamp>_<nome>/migration.sql` (escreva os backfills à mão, antes dos DROPs) e aplique com `db:migrate`. Confira que a saída do diff não contém a linha "Loaded Prisma config".

## Pontos de arquitetura

- `lib/config.ts` valida todas as variáveis no boot e falha cedo; qualquer variável nova entra lá. Em produção (`NODE_ENV=production`) `APP_ORIGIN` exige https e o simulador só roda com `ALLOW_SIMULATED_PAYMENTS=true`.
- Toda mudança de estado de pagamento passa por `lib/payments.ts` (`applyPaymentStatus`): simulador, resposta do cartão, webhook e reembolso usam a mesma transição, que também emite os e-mails e o link permanente.
- Gateways: `lib/gateway.ts` escolhe `simulated` ou `mercadopago` (`PAYMENT_GATEWAY`). Mercado Pago: `lib/mercadopago.ts` (cliente sem SDK, `fetch` injetável), `lib/mp-account.ts` (tokens do vendedor criptografados, refresh), `modules/gateway.ts` (OAuth), `modules/webhooks.ts` (assinatura `x-signature`, idempotência em `GatewayEvent`, releitura do pagamento na API). A taxa da nostore vai em `application_fee`, omitida quando é zero e refeita sem comissão no erro 2059 (vendedor é o dono da aplicação).
- Arquivos: `lib/storage.ts` com backends `local` (disco) e `blob` (Vercel Blob privado, autenticação OIDC). Produtos digitais são pacotes (`ProductFile`), copiados por pedido (`OrderFile`); download entrega um arquivo direto ou um ZIP (`yazl`). PDFs podem ser carimbados com nome e documento do comprador (`lib/pdf-stamp.ts`, opção `stampBuyer`). Upload de arquivo digital é feito pelo navegador direto ao Blob (`/seller/assets/digital/start` → `presign` → `complete`), porque a Vercel limita o corpo da requisição a 4,5 MB; imagens vão pela API com limite de 4 MB.
- Envio de produtos físicos: `lib/melhorenvio.ts` (cliente da API do Melhor Envio: OAuth, cotação, carrinho, compra, etiqueta, impressão, rastreio, cancelamento, agências), `lib/me-account.ts` (tokens de 30 dias criptografados, endereço de origem), `lib/shipping.ts` (cotação com cache de 10 min e revalidação na criação do pedido, compra de etiqueta retomável por etapa, sincronização de rastreio com e-mail "Produto enviado" uma única vez, postagem manual, cancelamento) e `modules/shipping.ts` (rotas). Produto físico tem `shippingMode` `melhorenvio` (exige conta conectada, origem e medidas; o comprador escolhe a transportadora e paga o frete, somado ao total sem taxa da nostore) ou `manual` (frete incluso, rastreio digitado). Pedido pago físico ganha um `Shipment`; a etiqueta é paga com a carteira Melhor Envio do vendedor. Cron diário (`vercel.json`, `CRON_SECRET`) atualiza rastreios.
- E-mails: enfileirados criptografados em `EmailJob`; `MAIL_DELIVERY=worker` usa o processo `worker.ts`, `inline` drena a fila antes da resposta nas requisições que enfileiraram (serverless). Template único em `lib/mail-template.ts` (`MailSpec` → texto e HTML no tema do site).
- Segurança: cookies httpOnly + CSRF por header, verificação de `Origin` em métodos de escrita (webhooks são exceção), erros ao cliente via `AppError` com códigos estáveis; o log de 500 inclui o `err`. Nunca registre segredos nem payloads de cartão.

## Produção (Vercel + Supabase)

- Conexões de banco: o pooler do Supabase em modo sessão aceita 15 clientes no total, então cada processo serverless mantém no máximo 2 conexões (`DB_POOL_MAX`, padrão 2 em produção e 10 fora dela) e derruba as ociosas em 10s. Rotas devem evitar muitas consultas em paralelo: prefira uma consulta agregada (`groupBy`) a várias. Esgotar o pooler aparece como `XX000 (EMAXCONNSESSION) max clients reached in session mode` e devolve 500.
- Domínio `https://nostore.com.br` (o host `.vercel.app` e `www` redirecionam). `vercel.json` define os serviços `app` (container nginx + web), `api` (framework fastify, root `apps/api`) e `web`. Banco: Supabase, use sempre o session pooler `aws-1-us-west-2.pooler.supabase.com:5432` (o host direto é só IPv6); senha com `#` vai como `%23`.
- Variáveis do serviço `api`: `DATABASE_URL`, `ENCRYPTION_KEY`, `APP_ORIGIN`, `NODE_ENV`, `PAYMENT_GATEWAY`, `ALLOW_SIMULATED_PAYMENTS`, `MP_CLIENT_ID`, `MP_CLIENT_SECRET`, `MP_WEBHOOK_SECRET`, `FILE_SCAN`, `MAIL_DELIVERY=inline`, `SMTP_*`, `MAIL_FROM`, `ME_CLIENT_ID`, `ME_CLIENT_SECRET`, `ME_ENV`, `CRON_SECRET`; o store Blob injeta `BLOB_STORE_ID` e `BLOB_WEBHOOK_PUBLIC_KEY`. Melhor Envio: Redirect URL `<origem>/api/v1/seller/shipping/callback`. Mercado Pago: Redirect URL `<origem>/api/v1/seller/gateway/callback`, webhook `<origem>/api/v1/webhooks/mercadopago` (tópico Pagamentos).
- Armadilhas do builder Fastify da Vercel: o entrypoint é detectado na ordem `src/app`, `src/index`, `src/server` e precisa importar `fastify` no próprio arquivo; o launcher substitui `listen` por um stub, então nunca use `await app.listen` no topo do módulo; não há disco gravável nem processo de longa duração; `waitUntil` não é honrado. Build do serviço `api` roda `npm run build` (= `prisma generate`).
- Migrações em produção são aplicadas manualmente com `npm run db:migrate` apontando para o banco de produção: antes do push quando só adicionam, logo após o push quando removem colunas usadas pelo código antigo.
- Logs: `npx vercel logs --deployment <host>`; variáveis: `npx vercel env add|rm <NOME> production` (o Claude não envia segredos: passe os comandos para a pessoa executar).

## Convenções

- Textos de interface, e-mails e mensagens de erro em português, seguindo o glossário; código e commits em inglês.
- Testes de integração constroem o app com `buildApp(config, { logger: false, fetch })` e limpam o que criaram; o Mercado Pago é simulado por um `fetch` falso em `test/mercadopago-flow.test.ts`.
- Transações que serializam por linha (publicação) precisam de `timeout` maior que o padrão por causa da latência do banco remoto.
