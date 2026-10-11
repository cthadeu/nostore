# nostore

Base da plataforma de venda por checkout individual. React + HeroUI v3, API Fastify, PostgreSQL e worker de e-mails.

## Executar com Docker

Requisitos: Docker Engine com Compose v2 ou superior, shell POSIX e OpenSSL. Não é necessário instalar Node.js na máquina.

```sh
./scripts/docker-up.sh
```

O script cria `.env` com uma chave aleatória somente se o arquivo ainda não existir e executa `docker compose up --build -d`. Se o `.env` já tiver sido configurado:

```sh
docker compose up --build -d
```

| Serviço | Acesso |
|---|---|
| Aplicação | http://localhost:8080 |
| E-mails locais (Mailpit) | http://localhost:8025 |
| Disponibilidade da API | http://localhost:8080/api/v1/ready |
| OpenAPI no ambiente local | http://localhost:8080/api/v1/openapi.json |
| PostgreSQL, para ferramentas locais | `localhost:5438`, banco/usuário `nostore`, senha `nostore_local` |

Crie uma conta na aplicação e abra o Mailpit para obter o e-mail de verificação. Nenhuma mensagem é enviada a destinatários externos nessa configuração.

O menu **Configurações** abre `/configuracoes`, com edição do perfil do vendedor e a seção **Recebimento**. O botão de conexão Mercado Pago permanece desabilitado até a implementação da integração; não há campo para inserir credenciais do gateway no painel do vendedor.

O Compose executa a migração versionada antes de iniciar API e worker. Nginx serve o frontend e encaminha `/api` para o Fastify na rede interna. API e worker usam usuário sem privilégios. Banco e arquivos privados persistem nos volumes `postgres_data` e `assets_data`; reiniciar ou reconstruir os containers não apaga os dados.

```sh
docker compose ps
docker compose logs --tail=100 api worker migrate
docker compose down
```

`down` preserva volumes. Não use `down -v` para uma instalação cujos dados deseja manter. Preserve também `ENCRYPTION_KEY`: substituí-la impede a leitura dos dados que foram criptografados com a chave anterior.

Para mudar a porta da aplicação, defina **ambas** as variáveis no `.env`, por exemplo `WEB_PORT=8090` e `DOCKER_APP_ORIGIN=http://localhost:8090`. O Compose não usa o `DATABASE_URL` local do `.env`: entre containers o host é `postgres`, e o SMTP usa `mailpit`.

Este Compose é para desenvolvimento local, com portas vinculadas a `127.0.0.1`, HTTP e credenciais locais. Para publicar na internet, configurar TLS, segredos próprios, origem HTTPS, SMTP real, backups e `NODE_ENV=production`; pagamentos reais ainda não estão disponíveis e o gateway simulado é bloqueado em produção.

## Desenvolvimento fora dos containers

Node.js 24 LTS recomendado (24 ou 25 aceitos pelo projeto).

```sh
npm ci
npm run setup
docker compose up -d postgres mailpit
npm run db:generate
npm run db:migrate
npm run dev
```

Frontend em `http://localhost:5173`, API em `http://localhost:3001`. Quando existir uma instalação global de libvips incompatível com o sharp, use `SHARP_IGNORE_GLOBAL_LIBVIPS=1 npm ci`.

## Validação

```sh
npm run build
npm test
```

Os testes de integração usam exclusivamente `TEST_DATABASE_URL` com banco terminado em `_test`. O Compose cria `nostore_test` na primeira inicialização do PostgreSQL. Aplique as mesmas migrações ao banco de testes antes de executar a suíte; sem `TEST_DATABASE_URL`, apenas esses testes são pulados.

```sh
docker compose run --rm -e DATABASE_URL=postgresql://nostore:nostore_local@postgres:5432/nostore_test migrate
docker compose run --rm --no-deps -e TEST_DATABASE_URL=postgresql://nostore:nostore_local@postgres:5432/nostore_test migrate node --test test/domain.test.ts test/integration.test.ts test/commerce.test.ts
```

## Estado da implementação

Disponível: autenticação e e-mails, perfil, produtos, publicação com limite de 5 ativos no plano Gratuito, upload privado verificado, checkout simulado, taxa administrativa versionada, pedidos, totais de vendas, notificações de compra e entrega digital protegida.

Pendentes: assinatura Pro, envio físico com rastreio/comprovante, suporte/moderação, operação em produção e integração real Mercado Pago. Os formulários usam HeroUI para ações e cartões; a migração dos campos nativos para componentes de formulário v3 permanece pendente.

## Fluxo de venda com pagamento simulado

O Compose usa `PAYMENT_GATEWAY=simulated` por padrão. Nenhum dinheiro é movimentado. Em execução fora do Compose, configure essa variável no `.env`. O modo simulado é recusado quando `NODE_ENV=production`, salvo em ambientes de demonstração com `ALLOW_SIMULATED_PAYMENTS=true`, que registram aviso no boot e nunca movimentam dinheiro.

1. Execute `./scripts/docker-up.sh` e aguarde o ClamAV iniciar e carregar suas assinaturas (a primeira execução pode demorar alguns minutos e exige acesso à internet).
2. Cadastre uma conta e confirme o e-mail pelo Mailpit em http://localhost:8025.
3. Crie um produto com imagem e um ou mais arquivos PDF/ZIP/EPUB. Vários arquivos formam um pacote, entregue ao comprador como um único ZIP. A opção "Personalizar PDFs" carimba nome e CPF/CNPJ do comprador no rodapé de cada página dos PDFs no momento do download. Cada arquivo passa pelo ClamAV (salvo com `FILE_SCAN=off`); se o scanner estiver indisponível, o upload falha sem liberar o arquivo.
4. Salve e clique em **Publicar produto**. Copie o link ou use **Abrir checkout**.
5. No checkout, informe dados de teste, selecione Pix ou cartão simulado e crie o pedido. O CPF fictício `529.982.247-25` pode ser usado no teste. Nenhum dado de cartão é solicitado.
6. Na conta do vendedor, abra **Pedidos → Simular aprovação**. O comprador recebe e-mails e sua página de pedido passa a oferecer o download.
7. **Simular recusa** encerra um pagamento pendente. **Simular reembolso** revoga downloads de uma compra aprovada. Pedidos pendentes expiram em 30 minutos.

### Taxa de serviço e administração

A taxa inicial é **0%**, acrescida ao preço do produto e sem frete. Para habilitar uma conta administradora, adicione o e-mail exato de uma conta cadastrada ao `.env`:

```dotenv
ADMIN_EMAILS=administrador@example.com
```

A conta precisa ter confirmado seu e-mail. Recrie a API após alterar o ambiente:

```bash
docker compose up -d --force-recreate api
```

O menu **Plataforma** e o atalho em **Configurações → Taxa de serviço** permitem alterar o percentual com duas casas decimais. Só administradores podem editar a taxa global. Cada alteração cria uma versão, registra o administrador e preserva os pedidos existentes. Checkouts abertos com condições antigas pedem atualização antes de continuar.

### Entrega e limites desta etapa

- Arquivos permanecem privados no volume `assets_data` e passam pelo ClamAV do Compose; nunca são servidos como arquivos estáticos.
- Cada pedido preserva a versão digital comprada. Pausar ou substituir o produto não altera downloads de compras anteriores.
- Acesso ao pedido por token aleatório armazenado apenas como hash, válido por 24 horas e renovável por e-mail. O navegador troca o token por uma sessão HttpOnly restrita ao pedido e remove o token da URL. Ticket de download válido por 60 segundos, de uso único e revalidado no servidor. O direito de download desta etapa vale por 12 meses após a aprovação.
- Pedidos e e-mails são registrados na mesma transação. Aprovações repetidas não duplicam as notificações no banco; o envio SMTP continua sujeito à semântica de entrega com repetição em falhas do worker.
- O checkout físico armazena endereço criptografado, visível apenas ao vendedor responsável. Registro de postagem ainda não está implementado.
- O adaptador em `apps/api/src/lib/gateway.ts` isola o simulador. Mercado Pago exigirá seu próprio ciclo assíncrono, credenciais, webhooks verificados, retentativas e conciliação.
- Assinatura Pro, moderação, armazenamento de objetos e operação em produção continuam pendentes.

ClamAV precisa de memória para suas assinaturas (reserve cerca de 3 GiB para o serviço). Em desenvolvimento fora do Docker, configure `CLAMAV_HOST` e `CLAMAV_PORT` para uma instância acessível; a porta do serviço não é publicada pelo Compose.
