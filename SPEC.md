# nostore — Especificação funcional e técnica

Versão: 1.7 · Data: 07/09/2026 · Status: proposta para implementação.

Vocabulário do negócio: [CONTEXT.md](./CONTEXT.md). O glossário define os termos; esta especificação concentra regras, cenários e decisões técnicas.

## 1. Objetivo

A nostore permite que pessoas e negócios vendam um produto físico ou digital através de um checkout hospedado, compartilhável por link. O vendedor não precisa montar uma loja virtual: cadastra seu produto, conecta o recebimento e usa o link em seu site, redes sociais ou mensagens.

O comprador acessa o checkout sem criar conta, paga por Pix ou cartão de crédito e recebe as comunicações e instruções de entrega por e-mail.

## 2. Escopo e decisões propostas

Esta versão incorpora as decisões do solicitante: até 5 produtos ativos gratuitos, upgrade mensal de R$ 29,90 para produtos ativos ilimitados, taxa percentual configurável nas configurações da plataforma, Mercado Pago inicial e frete sob responsabilidade do vendedor. Demais parâmetros identificados como propostas são padrões operacionais iniciais.

| Tema | Decisão para o MVP |
|---|---|
| Mercado | Brasil, português e moeda BRL |
| Produto | Até 5 produtos ativos por conta gratuita; produtos ativos ilimitados no plano pago de R$ 29,90/mês |
| Compra | Um produto e uma unidade por pedido, sem carrinho |
| Vendedor | Pessoa física ou jurídica; um proprietário por conta |
| Comprador | Compra sem cadastro; acesso posterior por link seguro |
| Pagamento | Pix e cartão de crédito à vista; parcelamento fica para evolução |
| Gateway | Mercado Pago como único gateway do MVP; arquitetura plugável para integrações futuras |
| Gateway por compra | Mercado Pago definido automaticamente; vendedor escolhe Pix e/ou cartão entre os métodos homologados para split |
| Taxa nostore | Percentual global configurável pelo administrador, acrescido ao subtotal do produto |
| Tarifa do gateway | Separada da taxa nostore; impacto sobre o recebimento informado ao vendedor |
| Frete | Responsabilidade e custo do vendedor; sem cobrança ou cálculo separado de frete no checkout do MVP |
| Estoque físico | Quantidade limitada com reserva durante o pagamento, ou venda sob encomenda explicitamente indicada |
| Digital | Um arquivo por produto; limite inicial proposto de 100 MB |
| Integração com site | Link e exemplo de botão HTML; iframe e SDK ficam fora do MVP |

Não fazem parte do MVP: catálogo público de loja, assinaturas dos produtos vendidos (a assinatura da conta nostore está incluída), cupons, afiliados, variantes, múltiplos itens, avaliações, emissão automática de nota fiscal, etiquetas de transporte e rastreamento automático.

## 3. Perfis e permissões

**Vendedor:** gerencia seu perfil, recebimento, produto, vendas, envio e solicitações de reembolso. Acessa apenas dados da própria conta.

**Comprador:** acessa o checkout público e apenas seu pedido/download por autorização específica. Não acessa o painel do vendedor.

**Administrador:** configura a taxa, acompanha falhas e integrações, suspende contas/produtos e presta suporte. Acesso a dados pessoais deve ser restrito e auditado. Operações financeiras e alterações de taxa exigem autenticação reforçada.

## 4. Cadastro e recebimento

1. Vendedor informa nome, e-mail e senha, aceita os termos e verifica seu e-mail.
2. Completa o perfil com tipo de pessoa, CPF/CNPJ e identificação comercial.
3. Informa ou vincula a conta bancária de recebimento no fluxo permitido pelo gateway: banco, agência, conta, tipo e titular, quando exigidos.
4. Conecta sua conta Mercado Pago por OAuth através da ação “Conectar Mercado Pago”.
5. A nostore consulta e registra a situação de habilitação para recebimento e split.
6. O vendedor pode preparar o produto durante a análise; a publicação depende de recebimento habilitado.

Estados da conexão: `not_connected`, `pending`, `active`, `restricted`, `revoked`.

**Restrição fundamental:** split distribui recursos entre recebedores reconhecidos pelo gateway. Uma conta bancária arbitrária cadastrada na nostore não é suficiente para garantir recebimento. A disponibilização do saldo e a transferência bancária seguem o contrato, a verificação e os prazos do provedor. A nostore não deve prometer depósito bancário instantâneo nem custodiar o valor integral da compra.

No Mercado Pago, a integração 1:1 utiliza credenciais do vendedor obtidas por OAuth e permite informar a comissão da plataforma no checkout transparente por `application_fee`. [Documentação oficial](https://www.mercadopago.com.br/developers/pt/docs/split-payments/split-1-1/integration-configuration/integrate-marketplace).

O MVP implementará apenas o adaptador Mercado Pago, com Checkout Transparente e split 1:1 entre vendedor e nostore. Outros gateways, incluindo PagBank, ficam como evolução futura, fora dos critérios de entrega inicial. A interface não exibirá seletor de gateway enquanto houver apenas uma integração disponível.

Antes da implementação do checkout real, validar em sandbox e com o provedor: habilitação comercial, Pix e cartão com split, tarifas, recebedores, estornos, chargebacks e disponibilidade em produção.

Dados bancários completos devem preferencialmente permanecer no gateway. Quando a integração exigir seu trânsito pela nostore, usar transporte seguro e evitar retenção desnecessária; exibir apenas dados mascarados. Tokens OAuth são criptografados e nunca enviados ao navegador.

## 5. Cadastro de produto

Campos obrigatórios: nome, descrição, imagem principal, preço positivo em BRL, tipo `physical` ou `digital`, métodos de pagamento e conexão Mercado Pago habilitada. O gateway é associado automaticamente, sem seleção pelo vendedor.

Campos físicos: prazo estimado de postagem e estoque ou indicação de encomenda. O vendedor organiza e arca com o envio, podendo considerar esse custo no preço cadastrado. Não haverá cobrança posterior de frete ao comprador. O foco de implementação e onboarding é digital; o fluxo físico permanece simplificado.

Campos digitais: arquivo privado, nome de apresentação, tamanho, tipo e versão. Formatos iniciais: PDF, EPUB e ZIP. ZIP é entregue como arquivo, sem extração no servidor.

Estados: `draft`, `active`, `paused`, `archived`. Rascunhos, pausados e arquivados não contam como ativos. Publicação ou reativação exige limite disponível no plano, validado atomicamente no backend. Publicação exige perfil e recebimento habilitados, campos válidos e arquivo digital aprovado pela verificação de segurança quando aplicável.

Regras:

- Gerar identificador público opaco e URL estável, por exemplo `/c/{publicId}`.
- Permitir visualizar, copiar o link e copiar um botão HTML com URL absoluta HTTPS.
- Produtos pausados ou arquivados não aceitam novas compras; pedidos anteriores continuam acessíveis.
- Alterações de preço, descrição ou arquivo não modificam pedidos já criados: cada pedido guarda uma cópia dos dados comerciais e a referência à versão adquirida.
- Alterar o tipo após uma venda exige um novo produto em rascunho, preservando o histórico anterior.
- Descrições não aceitam HTML arbitrário. Imagens públicas devem ser reprocessadas e ter metadados removidos.

## 6. Checkout e compra

1. Exibir imagem, nome, descrição, identificação do vendedor, preço e frete aplicável. A taxa nostore compõe o valor cobrado e não é discriminada ao comprador.
2. Solicitar nome completo, e-mail e documento exigido pelo gateway. Validar formato e dígitos verificadores sem afirmar que isso comprova identidade.
3. Para produto físico, solicitar CEP, logradouro, número ou indicação de sem número, complemento opcional, bairro, cidade e UF. Telefone apenas quando necessário para entrega ou gateway.
4. Exibir métodos habilitados e resumo com total final antes da confirmação.
5. Criar pedido no servidor e iniciar tentativa de pagamento com chave de idempotência.
6. Para Pix, mostrar QR Code, código copia e cola e expiração fornecida pelo gateway. Para cartão, usar tokenização no navegador com componentes/SDK do provedor.
7. Mostrar situação em processamento, pagamento confirmado, recusado ou expirado, com opção de retentativa quando segura.
8. Confirmar pagamento por processamento verificado no backend. Redirecionamento ou resposta do navegador não libera entrega.

Preço, frete, taxa, recebedor e gateway são determinados no servidor. Dados monetários enviados pelo navegador nunca são considerados autoridade.

Atualizações de situação podem usar polling com intervalo progressivo. A API pública exige autorização do pedido e retorna apenas informações necessárias, sem documento ou endereço completos.

Pedidos mantêm o preço por um período configurável, inicialmente 30 minutos, respeitando a expiração efetiva do meio de pagamento. Pedido expirado exige novo cálculo e nova confirmação do comprador. Pagamentos tardios devem ser conciliados e tratados, nunca descartados silenciosamente.

## 7. Taxa de serviço e split

Proposta: taxa acrescentada ao preço do produto, sem incidência sobre frete. A interpretação de “em cima do valor final” é formalizada abaixo para evitar cálculo circular.

Todos os valores são armazenados em centavos inteiros. Percentuais usam pontos-base: `500 bps = 5%`.

```text
P = preço do produto
F = 0 no MVP; custo logístico é responsabilidade do vendedor
r = percentual da nostore em pontos-base
S = arredondar_meio_para_cima(P × r / 10000)
T = P + F + S

total cobrado do comprador = T
comissão nominal nostore = S
parcela nominal do vendedor = P + F
```

Exemplo: produto R$ 100 e taxa de 5% → taxa R$ 5, total R$ 105, parcela nominal do vendedor R$ 100. Não há frete cobrado separadamente. O líquido efetivo depende das tarifas e regras do gateway.

- Funcionalidade “Configurações da plataforma → Taxa de serviço”: percentual global de 0 a 100%, com duas casas decimais, alterável apenas por administrador, com auditoria, prévia do cálculo e vigência. O percentual inicial deve ser definido antes da primeira publicação; não assumir um valor silenciosamente.
- A taxa por venda se aplica tanto ao plano gratuito quanto ao pago. A mensalidade de R$ 29,90 remunera o limite ilimitado de produtos e não substitui a taxa de serviço.
- Cada pedido congela taxa, versão da regra e valores calculados.
- Mudanças valem apenas para novos pedidos.
- O gateway recebe o total e a configuração do split compatível com sua API.
- Separar valores nominais, tarifas conhecidas, líquido previsto e líquido confirmado. Não chamar de “saldo disponível” um cálculo local.
- Se o gateway não suportar a combinação solicitada, bloquear a publicação ou o método com explicação clara.
- O comprador deve aceitar o total atualizado se o preço mudar antes da criação do pedido.

Política proposta para o MVP: reembolso integral inclui produto, frete e taxa nostore; tarifas não devolvidas pelo gateway precisam ter responsável definido antes do lançamento. Reembolso parcial fica fora do MVP. A reversão do split deve ser homologada por gateway; não implementar reembolso como transferência bancária manual.

## 8. Entrega digital

1. Vendedor solicita upload autenticado; API cria uma chave aleatória em armazenamento privado e fornece autorização temporária restrita.
2. Após o upload, o backend verifica tamanho real, tipo, integridade e varredura de malware. Arquivo fica em quarentena até aprovação.
3. Pagamento confirmado gera uma autorização de acesso associada ao pedido e à versão comprada.
4. E-mail leva à página `/access/{token}`, nunca diretamente ao arquivo.
5. O token, armazenado como hash, expira em 24 horas e é trocado por uma sessão restrita ao pedido; remover o token da URL após a troca.
6. Ao clicar em baixar, o backend verifica pagamento e autorização, registra o evento e gera uma URL assinada válida por até 5 minutos.
7. Comprador pode solicitar um novo link por e-mail, com resposta genérica e limite de tentativas.

O acesso à versão comprada permanece enquanto o pedido estiver pago e a política de retenção permitir. Reembolso confirmado ou chargeback revoga novas autorizações. Links assinados já emitidos podem continuar funcionando até expirar; arquivos já baixados não podem ser recuperados.

Não usar bucket público, caminhos previsíveis ou autorização baseada apenas no ID do pedido. A página de acesso não carrega rastreadores de terceiros e usa `Referrer-Policy: no-referrer`. Não consumir o token somente ao abrir um GET, pois scanners de e-mail podem visitar links automaticamente.

## 9. Entrega física

Após pagamento confirmado, o pedido aparece como “Aguardando envio”, com os dados necessários para postagem acessíveis ao vendedor proprietário.

Para marcar como enviado, exigir código de rastreio ou comprovante em JPG, PNG ou PDF, com limite inicial de 10 MB. Transportadora é obrigatória quando houver rastreio. Permitir informar ambos.

Comprovantes são privados, passam por validação/varredura e só ficam disponíveis ao comprador daquele pedido e ao vendedor autorizado. O registro guarda data, responsável e histórico de correções.

A confirmação do envio gera e-mail com transportadora, código e link seguro do pedido para consultar o comprovante. Links de rastreio são construídos a partir de transportadoras permitidas; não aceitar URLs arbitrárias como confiáveis.

Sem integração logística, “enviado” significa declaração do vendedor, não confirmação de entrega. Não marcar automaticamente como entregue. Correções relevantes devem gerar nova comunicação com deduplicação.

Para estoque limitado, reservar uma unidade ao iniciar o pagamento e liberar na expiração/cancelamento definitivo. Se um pagamento tardio ocorrer após a reserva expirar e não houver estoque, encaminhar para resolução e reembolso, sem prometer envio automático.

## 10. E-mails transacionais

| Evento | Destinatário | Conteúdo |
|---|---|---|
| Verificação/recuperação | Vendedor | Link temporário específico |
| Pedido criado | Comprador | Resumo, total, referência e situação; não afirmar que está pago |
| Pagamento confirmado | Comprador | Confirmação e resumo da compra |
| Digital disponível | Comprador | Link para página de acesso |
| Nova venda paga | Vendedor | Resumo e link autenticado do pedido |
| Produto enviado | Comprador | Data, rastreio e acesso ao comprovante |
| Reembolso confirmado | Comprador | Valor e situação da devolução |

Usar templates responsivos, versão texto e domínio com SPF, DKIM e DMARC. Envio assíncrono com retentativas, registro de falhas e chave única por evento/pedido/destinatário. Não anexar o produto digital nem expor CPF, endereço ou dados bancários em mensagens.

Eventos de um mesmo pedido devem respeitar a sequência lógica. Se o pagamento for imediato, o primeiro e-mail não pode apresentar uma situação pendente já superada. Falha no e-mail não altera a confirmação do pagamento nem bloqueia acesso pela página do pedido.

## 11. Dashboard e operação

Filtros por período e situação; horário apresentado em `America/Sao_Paulo`, armazenamento em UTC.

Indicadores:

- Compras pagas: pedidos com pagamento confirmado no período, com reembolsos e chargebacks destacados.
- Valor vendido: soma do preço dos produtos dos pedidos pagos, excluindo frete e taxa nostore.
- Total cobrado: produto + frete + taxa dos pagamentos confirmados.
- Reembolsos e chargebacks: valores e quantidades separados.
- Líquido previsto/confirmado: apresentar separadamente e apenas conforme dados disponíveis do gateway.
- Pendências de envio para produtos físicos.

Lista paginada: referência, comprador, produto, data, método, valor, situação do pagamento e situação da entrega. Detalhe com histórico, composição financeira, endereço quando físico, envio, reembolso e eventos de comunicação.

O painel administrativo oferece configuração de taxa, pesquisa de pedidos, gestão de suspensão, conexões com falhas, fila de eventos não processados e reprocessamento auditado. Não há botão para marcar manualmente um pedido como pago.

## 12. Estados e consistência

Separar o estado do pedido, das tentativas de pagamento e da entrega.

Usar “cancelamento do pedido” para encerramento sem pagamento confirmado e “cancelamento da renovação” para interrupção de futuras mensalidades Pro. Usar “reembolso” para devolução pelo fluxo do provedor e “chargeback” para reversão decorrente de contestação; referências genéricas a “estorno” neste documento devem ser interpretadas pelo fluxo correspondente.

| Entidade | Estados |
|---|---|
| Pedido | `pending_payment`, `paid`, `expired`, `cancelled`, `refund_pending`, `refunded`, `disputed`, `charged_back` |
| Tentativa de pagamento | `created`, `pending`, `approved`, `declined`, `cancelled`, `expired`, `unknown`, `refunded`, `disputed`, `charged_back` |
| Entrega digital | `locked`, `available`, `revoked` |
| Entrega física | `awaiting_payment`, `awaiting_shipment`, `shipped`, `cancelled` |

Pagamento aprovado libera a entrega uma única vez. Um evento antigo de pendência não regride um pedido pago. Estorno, disputa e chargeback são eventos posteriores válidos, tratados por regras explícitas e consulta ao gateway quando houver ambiguidade.

Disputa suspende novos downloads e sinaliza bloqueio de postagem enquanto estiver em análise. Se resolvida a favor do vendedor, o pedido volta a pago e o acesso é restaurado. Envios já realizados permanecem registrados mesmo em reembolso ou chargeback.

Uma recusa encerra a tentativa, não necessariamente o pedido. Retentativas não podem criar cobranças concorrentes sem verificar a tentativa anterior. Timeout gera estado `unknown` e conciliação; não autoriza troca automática de gateway. Se houver confirmação duplicada em tentativas diferentes, identificar e tratar a cobrança excedente, sem duplicar entrega ou receita contabilizada.

### Cenários de consistência do domínio

1. **Mesmo pedido, duas tentativas:** um cartão é recusado e o comprador escolhe Pix enquanto o pedido permanece válido. Há um pedido e duas tentativas; apenas a aprovação reconhecida conta como venda paga e libera a entrega. A situação da primeira tentativa permanece no histórico.
2. **Pagamento tardio após cancelamento:** uma confirmação chega depois de encerrar o pedido. O cancelamento não apaga a cobrança; conciliar o pagamento e resolver a obrigação de entrega ou reembolso, incluindo a disponibilidade de estoque.
3. **Cancelamento Pro durante período pago:** vendedor com 8 produtos ativos cancela a renovação. Mantém os benefícios até o fim do período pago; no downgrade, permanecem até 5 ativos e os excedentes são pausados, conforme a seleção e o critério já definidos. Pedidos e downloads anteriores continuam preservados.
4. **Arquivo atualizado após criação do pedido:** comprador cria pedido da versão A e o vendedor publica a versão B antes da confirmação. A compra continua vinculada à versão A; substituição do arquivo atual não reescreve o que foi adquirido.
5. **Link expirado com direito vigente:** o link de acesso expira, mas o período contratado de download continua válido. O comprador pode receber novo link sem fazer outra compra.
6. **Recebimento restrito com produto ativo:** um produto publicado continua contando para o limite do plano mesmo se a conexão de pagamento estiver restrita. Novas compras são bloqueadas por habilitação de recebimento; publicação, habilitação e moderação são dimensões distintas.
7. **Reclamação seguida de reembolso:** um mesmo pedido recebe reclamação e depois reembolso procedente. Preservar os dois fatos, contando o pedido uma única vez no indicador combinado; encaminhamento à análise não implica suspensão automática.
8. **Mensalidade reembolsada:** a devolução de uma cobrança Pro é tratada no faturamento da conta vendedora e não modifica pagamentos, split ou arquivos dos pedidos de seus compradores.

## 13. Arquitetura

Monólito modular com frontend e worker separados, evitando microsserviços no MVP.

```text
React + HeroUI
      │ HTTPS
      ▼
API Node.js ───────── PostgreSQL
      │                  │
      │               Outbox / jobs
      │                  ▼
      ├────────────── Worker Node.js ── E-mail
      ├── Interface de pagamentos → Adaptador Mercado Pago
      └── Armazenamento privado compatível com S3

Gateways ── webhooks ── API ── inbox persistente ── Worker
```

- Frontend: React com TypeScript, Vite, React Router, HeroUI v3, Tailwind CSS v4, SWR para consultas remotas e estilos por tokens.
- Backend: Node.js em versão LTS suportada no início da implementação, TypeScript e Fastify como framework HTTP.
- Organização da API: módulos registrados como plugins Fastify, com rotas, schemas de entrada/saída, hooks de autenticação/autorização e tratamento centralizado de erros. Regras de negócio ficam em serviços separados dos handlers HTTP; persistência e integrações ficam em componentes próprios.
- Banco: PostgreSQL, migrações versionadas e Prisma como proposta de acesso a dados.
- Worker: processo independente com fila persistida em PostgreSQL, retentativas e processamento com lease; Redis não é obrigatório no MVP.
- Contrato HTTP: REST `/api/v1`, documentado em OpenAPI.
- Armazenamento: objetos privados para arquivos digitais/comprovantes; imagens do produto servidas separadamente.
- Infraestrutura: containers, TLS, ambientes separados e serviço de segredos.

A documentação atual do HeroUI apresenta a biblioteca React baseada em Tailwind CSS v4 e React Aria Components. Fixar versões compatíveis na implementação e usar a documentação correspondente. [Documentação oficial](https://heroui.com/en/docs/react/getting-started).

Módulos: autenticação, vendedores, planos e assinaturas da plataforma, produtos, arquivos, checkout, pedidos, pagamentos, recebimento, entregas, notificações, suporte, risco, dashboard e administração.

### Convenções React

Diretrizes incorporadas da skill `vercel-react-best-practices` do repositório `vercel-labs/agent-skills`, consultada por `npx skills use` em 07/09/2026. Aplicar as regras pertinentes à SPA React com Vite; recursos exclusivos de Next.js, React Server Components e SSR não integram a arquitetura do MVP.

- Organizar frontend por domínio, separando páginas, componentes, hooks de dados e cliente HTTP tipado pelo contrato da API. Manter campos de formulário e estado visual no menor escopo necessário.
- Priorizar a eliminação de consultas sequenciais desnecessárias e a redução do JavaScript inicial. Consultas independentes, como métricas e lista de vendas, iniciam em paralelo após estabelecer a sessão; operações dependentes, como criar pedido e iniciar pagamento, mantêm sua ordem.
- Usar SWR para cache em memória, deduplicação e revalidação das leituras. Chaves incluem identidade da conta, recurso, filtros e paginação. Limpar o cache privado no logout e na troca de conta; nunca compartilhar dados privados entre vendedores.
- Revalidar consultas afetadas por publicação, envio, assinatura e demais mutações. Respostas antigas não podem sobrescrever a consulta de outro filtro ou pedido. Cache e atualização otimista nunca confirmam pagamento, liberam arquivo ou concedem plano Pro.
- Centralizar o polling do pedido em um hook compartilhado, com intervalo progressivo, pausa quando a página estiver oculta e parada em estados finais; revalidar ao retomar a página. A confirmação continua sendo responsabilidade do backend.
- Dividir bundles por rota com imports dinâmicos estáticos e React Router ou `React.lazy`/`Suspense`. Dashboard, administração e bibliotecas pesadas não fazem parte do carregamento inicial do checkout. Exibir fallback acessível e tratar falhas de carregamento com opção de tentar novamente.
- Carregar módulos opcionais quando necessários. Inicializar o SDK de pagamento somente no checkout correspondente, com instância controlada e indicação de carregamento; nunca pré-carregar uma operação de cobrança. Preload por foco ou hover pode antecipar apenas código e leituras autorizadas sem efeitos colaterais.
- Evitar arquivos locais que reexportem indiscriminadamente todos os módulos. Para HeroUI e outras bibliotecas, usar exports públicos e tipados compatíveis com a versão instalada; avaliar o bundle antes de trocar imports e não depender de caminhos internos não suportados.
- Calcular valores derivados simples durante a renderização, sem duplicá-los em estado atualizado por effects. Enviar formulários e iniciar mutações em handlers de interação; não disparar cobrança em effect de montagem. Manter idempotência no servidor mesmo com botão desabilitado.
- Declarar componentes fora de outros componentes e usar chaves estáveis por produto/pedido, preservando foco e estado dos formulários. Effects ficam reservados à sincronização com sistemas externos, com cleanup de listeners, timers e SDKs quando aplicável.
- Aplicar memoização somente a trabalho custoso identificado por medição. Usar atualizações funcionais de estado quando depender do valor anterior. Filtros pesados podem usar transições ou valores adiados sem atrasar a digitação nem o feedback de pagamento.
- Paginar vendas e produtos no servidor, inclusive no plano ilimitado. Virtualização é uma otimização posterior quando a medição justificar; não carregar todo o catálogo para contar produtos ativos.
- Não persistir documento, endereço, tokens de acesso ou dados de pagamento em `localStorage`. Preferências visuais não sensíveis, se persistidas, usam formato versionado e tolerância a falha de leitura.
- Validar o build de produção com análise de chunks e perfil de rede/renderização no checkout e dashboard. Conferir ausência de consultas duplicadas, preservação do foco, limpeza de cache entre contas e ausência de cobrança duplicada em remontagens, complementando os testes ponta a ponta já previstos.

### Convenções Fastify

Diretrizes incorporadas da skill `fastify-best-practices` do repositório `mcollina/skills`, consultada por `npx skills use` em 07/09/2026. Aplicar as convenções ao implementar a API:

- Separar `app.ts`, que exporta uma fábrica `buildApp(options)` sem abrir porta, de `server.ts`, responsável por inicialização, `listen` e encerramento do processo.
- Organizar cada domínio em plugin encapsulado com rotas, handlers e schemas. Usar `fastify-plugin` para infraestrutura compartilhada, como banco e autenticação, declarando dependências e ordem de registro. Manter hooks de vendedor e administrador nos respectivos escopos, sem atingir checkout público ou webhook.
- Definir schemas de entrada e resposta com TypeBox e integrar a inferência TypeScript com o type provider compatível do Fastify. Validar `params`, `querystring`, `body` e headers relevantes; documentar respostas por status. Schemas são código confiável do projeto, nunca conteúdo fornecido pelo usuário.
- Gerar OpenAPI a partir dos schemas usando `@fastify/swagger`, registrado antes das rotas. Respostas usam DTOs explícitos e schemas restritos para evitar exposição de campos internos, sem substituir a autorização.
- Usar hooks assíncronos sem misturar callbacks `done` com promises. Autenticação baseada em sessão pode ocorrer em `onRequest`; regras que dependem de dados validados e acesso ao banco ficam em `preHandler` ou nos serviços. Não realizar consultas ao banco dentro da validação estrutural dos schemas.
- Declarar decorators e seus tipos; inicializar contexto de usuário por requisição, sem compartilhar objetos mutáveis entre compradores ou vendedores.
- Centralizar erros com `setErrorHandler` e respostas de rota inexistente com `setNotFoundHandler`, mantendo o contrato de código, mensagem e `requestId`. Erros internos não expõem stack, SQL ou segredos.
- Usar o logger Pino integrado e `request.log`, com redação de credenciais e dados pessoais. Não registrar URLs contendo tokens de acesso nem payloads de pagamento integralmente.
- Configurar limites de corpo e timeouts explicitamente. Uploads grandes seguem diretamente ao armazenamento autorizado. Preservar os dados exigidos pela verificação de webhook antes de transformações, no escopo da rota correspondente.
- Priorizar plugins oficiais para cookies, CORS, headers de segurança e rate limit, com versões compatíveis. CORS usa origens explícitas quando necessário; `trustProxy` confia apenas nos proxies conhecidos da implantação.
- Compartilhar o cliente Prisma por processo por meio de plugin, encerrando-o em `onClose`; não criar conexão por requisição. Encerrar API e worker de forma controlada, preservando jobs pendentes.
- Preferir ESM e TypeScript executável com remoção nativa de tipos na versão Node.js LTS escolhida, com sintaxe compatível e imports explícitos. Executar `tsc --noEmit` em CI: remoção de tipos não realiza verificação estática.
- Testar rotas e hooks com `node:test` e `fastify.inject()`, fechando a aplicação após cada suíte. Cobrir validação, autorização entre vendedores, serialização sem dados sensíveis, idempotência e webhook. Testes de concorrência e transação continuam usando PostgreSQL real isolado.

## 14. Contrato dos gateways

```ts
interface PaymentGateway {
  capabilities(): GatewayCapabilities;
  connectSeller(input: ConnectSellerInput): Promise<ConnectionResult>;
  getSellerStatus(connectionId: string): Promise<SellerStatus>;
  createPayment(input: PaymentInput): Promise<PaymentResult>;
  getPayment(providerPaymentId: string): Promise<PaymentResult>;
  refundPayment(input: RefundInput): Promise<RefundResult>;
  verifyWebhook(rawBody: Uint8Array, headers: Headers): Promise<VerifiedEvent>;
}
```

No MVP, somente `MercadoPagoGateway` implementa esse contrato. Rotas parametrizadas por provedor aceitam apenas `mercadopago`; outros valores são rejeitados. Tipos concretos são definidos no código e no contrato de integração. `GatewayCapabilities` descreve Pix, cartão, split, estorno, expiração e requisitos de recebedor. `PaymentInput` inclui pedido, moeda, total, comissão, vendedor, método e idempotência; nunca contém número completo de cartão ou CVV.

Cada adaptador traduz erros e estados para o domínio, preserva referências externas e realiza autenticação/verificação conforme seu provedor. OAuth exige `state`, redirect URI permitida e renovação segura de tokens.

Webhooks devem ser verificados, persistidos antes do ACK e deduplicados por provedor/evento. Validar também conta recebedora, referência do pedido, moeda e valor. Consultar a API do provedor quando necessário para confirmar autenticidade ou situação.

A confirmação do pedido e a criação dos eventos de entrega/e-mail acontecem na mesma transação do PostgreSQL usando outbox. Efeitos externos são idempotentes; não presumir entrega “exatamente uma vez”.

Conciliação periódica consulta pagamentos pendentes, desconhecidos e alterações financeiras posteriores, com paginação, backoff e respeito aos limites do gateway. Falhas persistentes vão para uma fila de intervenção.

## 15. Modelo de dados

Todas as tabelas usam IDs não sequenciais expostos, timestamps UTC e restrições referenciais. Dados do vendedor usam `seller_id`; consultas e relacionamentos devem impedir referência cruzada entre contas.

| Tabela | Dados principais |
|---|---|
| `users` | E-mail único, hash de senha, verificação, papel, situação |
| `sellers` | Proprietário, tipo de pessoa, identificação, documento protegido, plano efetivo e estado de moderação |
| `plans` | Código, preço em centavos, intervalo e limite de produtos ativos (nulo = ilimitado) |
| `subscriptions` | Vendedor, referência Mercado Pago, estado, período pago, cancelamento e tolerância |
| `subscription_payments` | Assinatura, cobrança externa única, competência, valor e situação |
| `support_cases` | Pedido/assinatura, solicitante autorizado, categoria, evidências, protocolo e prazos |
| `risk_reviews` | Vendedor, janela, indicadores, evidências, decisão, responsável e recurso |
| `retention_holds` | Entidade, fundamento, início, revisão e término da preservação |
| `gateway_connections` | Vendedor, provedor, ID externo, segredos criptografados, situação |
| `bank_account_references` | Referência externa, banco e final da conta; dados mínimos |
| `products` | Vendedor, ID público, nome, descrição, preço, tipo, situação, frete, estoque |
| `product_payment_methods` | Produto, conexão e métodos habilitados |
| `assets` | Vendedor, chave do objeto, tamanho, MIME, checksum, resultado da varredura |
| `product_file_versions` | Produto, arquivo, versão e data de publicação |
| `fee_policies` | Percentual em bps, vigência, administrador responsável |
| `orders` | Vendedor, produto, referência, comprador protegido, snapshots, valores, estado |
| `order_addresses` | Pedido e endereço de entrega protegido |
| `payment_attempts` | Pedido, gateway, ID externo, idempotência, método, valores e situação |
| `refunds` | Pagamento, referência externa, valor, situação e motivo |
| `financial_events` | Pagamento, tipo, valor, tarifa, referência externa e ocorrência |
| `inventory_reservations` | Produto, pedido, quantidade, vencimento e situação |
| `download_grants` | Pedido, versão, hash de token, validade e revogação |
| `download_events` | Autorização, data e resultado, com minimização de metadados |
| `shipments` | Pedido, transportadora, rastreio, comprovante, responsável e data |
| `webhook_events` | Gateway, evento externo único, verificação, processamento e erro |
| `outbox_events` / `jobs` | Evento, payload mínimo, tentativas, disponibilidade e lease |
| `email_deliveries` | Evento único, destinatário, provedor e situação |
| `audit_logs` | Ator, ação, entidade, data e alterações sem segredos |

Restrições relevantes: valores não negativos; limite de produtos ativos conforme plano, com lock da conta e contagem/transição na mesma transação (inclusive downgrade), impedindo ultrapassagem por publicações concorrentes; idempotência única por escopo; evento externo único por provedor; referência de pagamento única por conexão; índices por vendedor/data e pedido/situação. Identificação aleatória não substitui autorização.

Pedido armazena snapshot de nome, preço, frete, taxa, política aplicada, versão digital e conexão de pagamento. Troca de gateway não muda o processamento de pedidos anteriores.

## 16. API mínima

| Método e rota | Uso e proteção |
|---|---|
| `POST /auth/register`, `/auth/login` | Cadastro e sessão; rate limit |
| `POST /auth/verify-email`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/logout` | Ciclo de acesso |
| `GET/PATCH /seller/profile` | Perfil do vendedor autenticado |
| `POST /seller/gateways/:provider/connect` | Iniciar vínculo de recebedor |
| `GET /integrations/:provider/callback` | Callback OAuth com validação de estado |
| `GET /seller/gateways` | Situação e capacidades |
| `POST/GET /seller/products` | Criar/listar produtos próprios |
| `GET/PATCH /seller/products/:id` | Consultar/editar produto próprio |
| `POST /seller/products/:id/publish` ou `/pause` | Transição validada |
| `POST /seller/assets/upload-intents` | Autorizar upload privado |
| `POST /seller/assets/:id/complete` | Finalizar e verificar arquivo |
| `GET /checkout/:publicId` | Informações públicas do produto |
| `POST /checkout/:publicId/orders` | Criar pedido; idempotência obrigatória |
| `POST /orders/:id/payments` | Pagar; sessão restrita ao pedido e idempotência |
| `GET /orders/:id/status` | Consultar situação com autorização do pedido |
| `POST /webhooks/:provider` | Entrada verificada do gateway |
| `POST /access/exchange`, `/access/request` | Trocar token/solicitar novo acesso |
| `POST /orders/:id/download` | Gerar URL assinada após autorização |
| `GET /orders/:id/shipment` | Consultar envio com autorização do comprador |
| `GET /seller/orders`, `/seller/orders/:id` | Vendas próprias |
| `POST /seller/orders/:id/shipment` | Informar envio pago e autorizado |
| `POST /seller/orders/:id/refund` | Solicitar estorno integral, com idempotência |
| `GET /seller/dashboard` | Métricas por período |
| `GET/POST /admin/fee-policies` | Consultar/criar vigência da taxa na funcionalidade de configurações |
| `GET /seller/billing` | Plano, uso, período pago e cobranças |
| `POST /seller/billing/subscribe` | Iniciar assinatura Pro; idempotência obrigatória |
| `POST /seller/billing/cancel` | Cancelar renovação da assinatura própria |
| `PUT /seller/billing/retained-products` | Selecionar até 5 produtos para downgrade |
| `POST/GET /support/cases` | Criar/listar casos com autorização do pedido, assinatura ou vendedor |
| `POST /support/cases/:id/messages` | Responder caso autorizado |
| `GET /admin/risk-reviews` | Fila de candidatos a suspensão |
| `POST /admin/risk-reviews/:id/decision` | Registrar decisão fundamentada e auditada |

Respostas têm código de erro estável, mensagem compreensível e `requestId`. Validar payloads no servidor, paginar listas e proteger mutações baseadas em cookies contra CSRF.

## 17. Interface e identidade visual

Layout simples, com bastante espaço em branco, tipografia legível, poucos elementos por tela e uma ação principal evidente. Utilizar componentes HeroUI para inputs, botões, cards, tabelas, modais e notificações.

| Token | Cor | Aplicação |
|---|---|---|
| `surface` | `#FFFFFF` | Fundo principal e cartões |
| `primary-soft` | `#a9cbb7` | Destaques, seleção e superfícies de ação |
| `accent-soft` | `#efecca` | Avisos informativos e blocos de apoio |
| `foreground` | `#5e565a` | Texto, ícones e botões de alto contraste |

Usar texto `#5e565a` sobre verde/bege e texto branco sobre fundo `#5e565a`, validando contraste antes de aprovar componentes. Não presumir que texto branco sobre verde claro seja legível. Erros e estados usam ícone e rótulo, com cores semânticas adicionais somente quando necessário e com contraste validado.

### Convenções HeroUI v3

Diretrizes incorporadas da skill `heroui-react` do repositório `heroui-inc/heroui`, consultada por `npx skills use` em 07/09/2026. Antes de implementar cada componente, consultar sua documentação v3 para confirmar anatomia, propriedades e comportamento.

- Usar `@heroui/react`, `@heroui/styles` e `tailwind-variants` em versões compatíveis, com Tailwind CSS v4 integrado ao Vite. A configuração permanece React/Vite. HeroUI v3 dispensa `HeroUIProvider` e usa animações CSS; não adicionar dependência de animação apenas para inicializar a biblioteca.
- No CSS global, importar `tailwindcss` antes de `@heroui/styles`, seguidos do tema nostore. Fixar as versões no lockfile e conferir requisitos de instalação na documentação da versão adotada. [Guia de instalação](https://heroui.com/docs/react/getting-started/quick-start.mdx).
- Compor componentes conforme sua anatomia documentada, como `Card.Header`, `Card.Title` e `Card.Content`; não presumir propriedades da v2. Preservar a composição ao criar componentes reutilizáveis da nostore.
- Usar variantes semânticas: `primary` para a ação principal, `secondary`/`outline` para alternativas, `tertiary`/`ghost` para menor destaque e `danger` para ações destrutivas.
- Para ações de botões HeroUI, usar `onPress`. Em formulários, centralizar a submissão em `onSubmit` e evitar executar a mesma mutação também no botão. Representar processamento com `isPending` e indisponibilidade com `isDisabled`, mantendo nome acessível e feedback textual. [Documentação de Button](https://heroui.com/docs/react/components/button.mdx).
- Definir cores no tema por variáveis CSS em `oklch`, convertidas a partir da paleta fornecida. Componentes consomem tokens e variantes, sem repetir hexadecimais por tela. Personalizações estruturais usam classes BEM documentadas e camadas CSS. [Documentação de temas](https://heroui.com/docs/react/getting-started/theming.mdx).

Mapeamento proposto para o tema claro inicial; os nomes da tabela de identidade visual acima representam papéis da marca, não necessariamente nomes nativos do HeroUI:

| Variável CSS | Cor de referência | Uso na nostore |
|---|---|---|
| `--background`, `--surface`, `--overlay` | `#FFFFFF` | Página, cartões e sobreposições |
| `--foreground`, `--surface-foreground`, `--overlay-foreground` | `#5e565a` | Conteúdo textual |
| `--accent` / `--accent-foreground` | `#5e565a` / `#FFFFFF` | Ação principal com contraste |
| `--accent-soft` / `--accent-soft-foreground` | `#a9cbb7` / `#5e565a` | Destaques suaves da marca |
| `--nostore-support` / `--nostore-support-foreground` | `#efecca` / `#5e565a` | Blocos informativos, com tokens customizados expostos ao Tailwind |
| `--focus`, `--link` | `#5e565a` | Foco visível e links identificáveis |

Validar também estados hover, pressionado, inválido, pendente e desabilitado. Formulários devem associar labels, descrições e erros aos campos; modais devem preservar foco e retorno ao acionador. Respeitar redução de movimento e testar por teclado e leitor de tela. O uso da biblioteca não substitui a verificação de acessibilidade dos fluxos.

Telas:

1. Apresentação da plataforma e cadastro/login.
2. Onboarding com etapas: perfil → recebimento → produto → compartilhar.
3. Dashboard com indicadores agregados, filtro por produto, vendas recentes e uso do plano (ex.: 3/5 produtos ativos).
4. Editor do produto com prévia e área de link compartilhável.
5. Configurações de recebimento e perfil.
6. Lista/detalhe de vendas e formulário de envio.
7. Checkout público.
8. Situação do pagamento e pedido.
9. Página de download digital ou acompanhamento de envio.
10. Configurações da plataforma, administração de contas, reclamações, análise de suspensão e falhas.
11. Plano e faturamento: comparação Gratuito/Pro, upgrade, próxima cobrança, histórico, cancelamento e seleção dos produtos mantidos no downgrade.
12. Atendimento: abrir e acompanhar reclamação ou pedido de reembolso com protocolo.

Checkout em duas colunas no desktop, com resumo e formulário; uma coluna no celular, mantendo total e ação de pagamento fáceis de localizar. Dashboard usa navegação lateral no desktop e menu compacto no celular. Tabelas passam a cartões quando necessário.

Critérios: funcionar desde 320 px sem rolagem horizontal; alvos de toque de pelo menos 44 px; labels persistentes; navegação por teclado; foco visível; erros junto ao campo; feedback de carregamento e prevenção de duplo clique; estados vazios úteis. Acessibilidade alvo: WCAG 2.2 AA.

## 18. Segurança e operação

- Senhas com Argon2id; sessões revogáveis em cookies `HttpOnly`, `Secure` e `SameSite` apropriado ao fluxo.
- Controle de acesso por vendedor em todas as operações, incluindo arquivos, métricas e jobs.
- TLS, gestão de segredos, criptografia de tokens e dados pessoais sensíveis; logs sem documentos, tokens, PAN ou CVV.
- Cartão tokenizado diretamente pelo provedor. A escolha do componente e o escopo de conformidade devem ser validados com o gateway antes de produção.
- Upload com limites reais, validação de conteúdo, varredura e nomes seguros; documentos privados não são renderizados como HTML.
- Rate limit em login, checkout, recuperação, emissão de acesso e consulta de pedido; proteção contra abuso de cobrança e e-mail.
- Política de privacidade, termos, consentimentos necessários, procedimento de atendimento ao titular e retenção por categoria definidos antes do lançamento. Não prometer exclusão imediata de registros sujeitos a retenção obrigatória.
- Backups criptografados com restauração testada. Metas iniciais propostas: RPO de até 24 horas e RTO de até 8 horas.
- Observabilidade com correlação por pedido, métricas de pagamento, atraso de webhook, falhas de e-mail, fila, armazenamento e erros por gateway.
- Alertas para indisponibilidade do gateway, conexões revogadas, divergência financeira e fila travada.
- URLs de retorno, redirecionamentos e rastreio usam listas permitidas; checkout e acesso privado não são indexados por buscadores.

Metas propostas: disponibilidade mensal de 99,5%; p95 de leituras internas abaixo de 500 ms em teste com 50 usuários simultâneos, excluindo gateway/upload; criação dos jobs de entrega em até 60 segundos após receber e verificar confirmação em operação normal. O recebimento do e-mail depende do provedor e da caixa postal.

## 19. Critérios de aceite

1. Um vendedor com e-mail verificado e recebimento habilitado publica um produto e obtém um link utilizável em outro site.
2. Produto digital sem arquivo aprovado e vendedor sem split habilitado não podem iniciar vendas.
3. Um comprador conclui Pix e cartão em cenários homologados, sem cadastro e com total discriminado.
4. Alterar preço ou taxa pelo navegador não modifica a cobrança calculada no servidor.
5. Alterar a taxa global não afeta pedidos existentes.
6. O split atribui a comissão e a parcela do vendedor corretamente, comprovado por consulta/transação no ambiente do gateway.
7. Documento completo do cartão e CVV nunca passam pelo backend nem pelos logs da nostore.
8. Retentativa após timeout não duplica a cobrança; confirmação duplicada de webhook não duplica acesso ou e-mail.
9. Webhooks inválidos ou com conta/valor divergentes não liberam entrega; eventos fora de ordem não regridem pagamento confirmado.
10. Sem pagamento confirmado, pedido digital não permite baixar. Após confirmação, comprador recebe acesso temporário e consegue renovar pelo seu e-mail.
11. Tokens expirados, pedidos de outro comprador e arquivos de outro vendedor são inacessíveis.
12. Pagamento físico exige endereço; envio exige rastreio ou comprovante aprovado; comprador recebe comunicação e acesso seguro.
13. Reembolso confirmado e chargeback revogam novos downloads e ajustam indicadores sem apagar o histórico.
14. Dashboard corresponde aos pedidos e valores registrados, distinguindo vendas, taxas, frete, devoluções e líquido.
15. Falha/reinício do worker preserva eventos; retentativas não duplicam efeitos já concluídos.
16. Checkout e painel funcionam em celular e desktop, com teclado, foco e contraste verificados.
17. Pagamento tardio sem estoque gera ocorrência operacional e resolução financeira definida.
18. Conta gratuita publica até 5 produtos; a sexta publicação, inclusive concorrente, é bloqueada com opção de upgrade.
19. Pagamento confirmado de R$ 29,90 ativa Pro; webhook repetido não duplica assinatura, cobrança contabilizada ou período.
20. Cancelamento interrompe renovação; downgrade preserva pedidos e arquivos vendidos e pausa apenas produtos excedentes.
21. Frete separado é sempre zero no checkout; vendedor vê sua responsabilidade de envio.
22. Reclamações/estornos que atingem critérios geram análise auditável, sem suspensão automática por volume isolado.
23. Administrador altera a taxa pelas configurações; novas compras usam a nova vigência e compras anteriores preservam o cálculo.
24. Reembolso, reclamação, recurso e retenção seguem os prazos e regras operacionais das seções 23 e 24.

## 20. Plano de implementação e validação

**Etapa 1 — Homologação Mercado Pago:** aplicação de teste, conexão OAuth do vendedor, Checkout Transparente, Pix/cartão com split 1:1, comissão via `application_fee`, verificação de webhook e estorno. Saída: viabilidade documentada e regras de tarifa confirmadas.

**Etapa 2 — Fundação:** monorepo, API, banco, autenticação, isolamento por vendedor, design tokens, armazenamento e pipeline de implantação.

**Etapa 3 — Produto, planos e recebimento:** onboarding, integração do vendedor, upload/varredura, editor, publicação, limite de 5 ativos, upgrade Pro de R$ 29,90, cobrança recorrente, cancelamento, downgrade e link.

**Etapa 4 — Venda:** checkout, cálculo financeiro, pedido, pagamento, inbox/outbox, conciliação e confirmação.

**Etapa 5 — Pós-venda:** acesso digital, envio físico, notificações, dashboard e estorno integral.

**Etapa 6 — Operação:** configurações da plataforma, atendimento/reclamações, análise de suspensão, retenção, auditoria, alertas, testes de restauração, acessibilidade e homologação ponta a ponta.

**Evolução futura — Outros gateways (fora do MVP):** adicionar novos adaptadores quando houver demanda, reutilizando o contrato e homologando cada integração. Não há segundo gateway obrigatório para o lançamento.

Testes prioritários: unidade para cálculo/arredondamento e estados; integração com PostgreSQL para concorrência, autorização e outbox; contrato/sandbox do Mercado Pago; ponta a ponta para Pix, cartão, download e envio; casos negativos de assinatura, isolamento entre vendedores, timeout e duplicação. Validar reconciliação e retomada após falha de processo.

## 21. Decisões consolidadas e parâmetros de lançamento

Confirmado: taxa percentual nas configurações da plataforma; plano Gratuito com até 5 produtos ativos; Pro com produtos ativos ilimitados por R$ 29,90/mês; Mercado Pago como gateway inicial; foco em produtos digitais e frete sob responsabilidade do vendedor; reclamações e estornos tornam vendedores candidatos a análise de suspensão.

Permanece como premissa de cálculo: taxa acrescida ao preço do produto. A resposta sobre configurabilidade não definiu explicitamente quem absorve a taxa. Não há frete separado no MVP; se o vendedor embutir logística no preço, a taxa incide sobre esse preço integral.

Antes de produção, configurar o percentual inicial e homologar Mercado Pago para vendas com split e para a assinatura da própria nostore. Limite de 100 MB por arquivo e políticas abaixo são padrões propostos, com versão e comunicação nos termos do serviço.

## 22. Planos e assinatura da conta nostore

| Plano | Mensalidade | Produtos ativos | Taxa por venda |
|---|---|---|---|
| Gratuito | R$ 0 | Até 5 | Percentual vigente da plataforma |
| Pro | R$ 29,90 | Ilimitados | Mesmo percentual vigente |

“Ilimitados” refere-se à quantidade de produtos ativos; o limite por arquivo e os controles contra abuso continuam aplicáveis. Cada produto tem seu próprio link de checkout. Criar rascunhos não exige Pro; publicar o sexto produto exige assinatura válida.

A mensalidade é uma cobrança da nostore ao vendedor, separada das compras dos consumidores: BRL 2990 centavos, periodicidade mensal, recebida pela conta da nostore, sem split e sem adicionar a taxa percentual de checkout. Implementar serviço de assinatura separado do adaptador de vendas, com credenciais da plataforma. A documentação de planos do Mercado Pago prevê cobrança recorrente; a integração escolhida deve ser homologada com notificações e consulta de cobranças. [Mercado Pago — Planos de assinatura](https://www.mercadopago.com.br/developers/pt/docs/subscription-plans/overview).

Padrões operacionais propostos:

- Checkout de assinatura hospedado no Mercado Pago; cartão recorrente como método inicial a homologar. Não prometer Pix recorrente. Exibir R$ 29,90/mês, renovação e cancelamento antes da contratação.
- Estados locais: `pending`, `active`, `past_due`, `cancelled`, `expired`. Registrar separadamente cancelamento da renovação e término do período já pago.
- Ativar Pro somente após confirmação da primeira cobrança no backend; autorização da assinatura ou retorno do navegador não bastam.
- Renovação confirmada mantém o benefício pelo período correspondente. Usar referências únicas por cobrança e reconciliar notificações ausentes ou fora de ordem. Não somar um mês a cada webhook.
- Cobrança recusada: notificar, acompanhar retentativas do provedor e oferecer 7 dias corridos de tolerância após o fim do período pago. Depois, aplicar o limite gratuito. Não criar cobranças paralelas às retentativas do gateway.
- Cancelamento pode ser solicitado no painel a qualquer momento e interrompe futuras renovações após confirmação no provedor. Benefícios continuam até o final do período pago, sem cobrança proporcional na regra comercial comum, preservados direitos legais e tratamento de cobrança indevida.
- Antes do downgrade, permitir selecionar até 5 produtos ativos para manter. Sem seleção, manter os 5 mais antigos por data de ativação e ID como desempate; pausar excedentes com motivo `plan_limit`. Avisar por e-mail e painel.
- Downgrade não exclui produtos, arquivos vendidos, pedidos ou acessos anteriores. Upgrade posterior permite reativação explícita dos produtos pausados.
- Cancelamento, renovação e publicação usam o mesmo controle transacional de plano. Bloquear segunda assinatura ativa ou pendente para a mesma conta; conciliar timeouts antes de permitir nova tentativa.
- Reembolso da mensalidade não é estorno de venda de produto; tratar em faturamento próprio. Chargeback da assinatura encerra o benefício correspondente e abre análise, preservando entregas já vendidas.
- Notificações: assinatura ativada, renovação confirmada, falha de cobrança, tolerância próxima do fim, cancelamento e downgrade aplicado.

Homologação inclui primeira cobrança, renovação, recusa, recuperação, cancelamento, estorno, evento duplicado, evento atrasado e indisponibilidade do provedor.

## 23. Reembolso, atendimento e suspensão

Estas são políticas operacionais iniciais da nostore, não percentuais universais de mercado. Aplicar a legislação e o contrato do gateway quando exigirem tratamento diferente.

### Reembolso e atendimento

- Disponibilizar canal de suporte e solicitação de reembolso na página segura do pedido, com protocolo, histórico e comunicação por e-mail.
- Para relações de consumo abrangidas, respeitar o direito de arrependimento de 7 dias nas contratações fora do estabelecimento, contado conforme assinatura ou recebimento do produto/serviço. O download, isoladamente, não gera recusa automática. Pedidos por defeito, não entrega, fraude ou cobrança indevida não ficam limitados à janela de arrependimento. [CDC, artigo 49](https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm).
- Confirmar protocolo imediatamente; primeira resposta em até 2 dias úteis e meta de resolução em até 5 dias úteis, sem alongar prazos legais. Vendedor tem 2 dias úteis para responder; depois, escalar à nostore. Informar atualizações quando depender do gateway.
- Para arrependimento procedente, devolução integral do valor cobrado, incluindo taxa nostore, pelo fluxo do Mercado Pago; registrar solicitação e executar sem demora indevida. Informar separadamente o prazo de processamento e o prazo de crédito do meio de pagamento.
- Para físico, coordenar retorno com o vendedor, sem impor custo de devolução ao consumidor no exercício regular do arrependimento. No MVP, postagem e logística reversa são organizadas pelo vendedor.
- Para digital, revogar novos acessos após reembolso confirmado; a mera abertura de reclamação não revoga acesso. Disputas formais de pagamento seguem as regras da seção 12.
- Fora das hipóteses legais, analisar concessão comercial com justificativa. Termos da plataforma não podem eliminar direitos obrigatórios.
- Impedir reembolso duplicado entre painel e disputa do gateway. Se já houver contestação, consultar o provedor e seguir o fluxo correspondente.
- Tarifa não devolvida não reduz o reembolso devido ao comprador. Como regra comercial proposta, vendedor responde pelos custos atribuídos à sua venda e nostore devolve sua comissão; operacionalização depende do contrato e não autoriza débito bancário arbitrário.
- Aplicar análise dos direitos cabíveis também à contratação da assinatura Pro, sem presumir que toda relação empresarial é relação de consumo.

### Candidatura à suspensão

Registrar reclamações vinculadas a pedidos reais, deduplicadas por pedido e motivo. Distinguir reclamação, reembolso voluntário, arrependimento, disputa e chargeback. Reembolso legítimo não comprova irregularidade.

Gatilhos iniciais configuráveis para abrir revisão humana, e não suspender automaticamente:

- 3 pedidos distintos com reclamações nos últimos 30 dias; ou
- 3 pedidos distintos com reembolso ou chargeback nos últimos 30 dias; ou
- Pelo menos 20 pedidos pagos nos últimos 30 dias e 10% ou mais desses pedidos com reclamação, reembolso ou chargeback, contando cada pedido uma vez; ou
- Evidência concreta de fraude, arquivo malicioso, produto proibido ou determinação/restrição do gateway, independentemente do volume.

Os valores acima são parâmetros internos propostos, não limites oficiais do Mercado Pago. Revisão considera volume de vendas, gravidade, procedência, duplicações, solução e reincidência. Casos são deduplicados por vendedor/janela e podem ser reabertos diante de novas evidências.

Estados de moderação: `active`, `under_review`, `restricted`, `suspended`. Estar em análise não bloqueia vendas automaticamente. Restrição ou suspensão exige decisão administrativa fundamentada e auditada; risco concreto pode justificar bloqueio preventivo imediato por administrador autorizado.

Comunicar motivo e ações necessárias ao vendedor, permitir recurso em até 10 dias corridos e responder em até 5 dias úteis. Suspensão bloqueia novos checkouts e publicações, preservando suporte, reembolsos, histórico e cumprimento de pedidos existentes. Arquivo perigoso é bloqueado especificamente e seus compradores recebem orientação de resolução. Não congelar nem confiscar saldo por conta própria: medidas financeiras dependem do gateway e fundamento aplicável.

## 24. Retenção de dados e versões digitais

Proposta de retenção por finalidade, com rotinas automáticas e registro de execução. Retenção não equivale a acesso irrestrito: aplicar autorização, criptografia e minimização durante todo o período.

| Categoria | Política operacional inicial |
|---|---|
| Upload incompleto ou rejeitado | Excluir em até 7 dias, salvo investigação documentada |
| Arquivo sem venda e sem referência, excluído pelo vendedor | Lixeira privada por 30 dias e depois exclusão |
| Versão digital vendida | Preservar enquanto houver direito de acesso de um pedido; não excluir por troca de arquivo, downgrade ou suspensão do vendedor |
| Direito de download | Mínimo de 12 meses após pagamento, divulgado antes da compra; oferta com prazo maior prevalece e congela no pedido |
| Versão vendida sem direitos de acesso vigentes | Excluir após 30 dias, se nenhuma obrigação de preservação permanecer |
| Pedido abandonado sem pagamento ou disputa | Excluir ou anonimizar dados pessoais após 90 dias |
| Registros financeiros, suporte de transações e comprovantes | Referência operacional de 5 anos após encerramento da transação/caso, com prazo por categoria sujeito à base legal aplicável; não conservar dados pessoais desnecessários junto ao registro financeiro |
| Logs técnicos e de download | 90 dias, com dados minimizados; registros sujeitos a regra legal específica usam prazo próprio |
| Dados cadastrais após encerramento | Excluir/anonimizar em até 30 dias, exceto dados necessários a pedidos, obrigações e defesa de direitos |
| Backups | Rotação de até 35 dias; exclusões reaplicadas caso haja restauração |

Ao publicar, informar claramente o período de download; não anunciar acesso vitalício. Preservar versões compartilhadas por vários pedidos até o último direito expirar. A expiração do link de 24 horas é diferente da duração do direito de acesso: dentro do período contratado, comprador pode renovar o link.

Antes da expiração do direito, enviar lembrete com 30 dias de antecedência. Encerramento da conta do vendedor não remove arquivos ainda devidos a compradores. Se houver necessidade de encerrar o serviço, oferecer comunicação, exportação e solução para obrigações pendentes antes da exclusão.

Preservação por investigação, disputa ou obrigação deve registrar fundamento, escopo, responsável e data de revisão; não usar retenção indefinida sem justificativa. A LGPD prevê término do tratamento e hipóteses específicas de conservação. Os prazos operacionais acima não constituem uma obrigação legal uniforme de cinco anos. [LGPD, artigos 15 e 16](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm).

## Implementação incremental — gateway simulado (09/09/2026)

Por orientação do usuário, a integração Mercado Pago passa para o fim da sequência de implementação. Pedidos, taxa, checkout, publicação e entrega são implementados antes, usando um adaptador de pagamento simulado.

- A simulação é explicitamente identificada para vendedor e comprador, não coleta dados de cartão e não gera Pix pagável. Somente o vendedor autenticado e proprietário do pedido pode simular aprovação, recusa ou reembolso. O ambiente de produção rejeita o modo simulado.
- A taxa é global, editada por administradores com e-mail confirmado e autorizados via `ADMIN_EMAILS`; o vendedor pode consultá-la. O valor inicial é 0%, até configuração explícita. O percentual é acrescido ao preço do produto, sem frete, com histórico imutável e identificação do administrador. Pedidos preservam a política usada na criação.
- O pedido de teste expira em 30 minutos. Cada intenção de compra possui uma chave aleatória para repetição idempotente. Alterações no produto ou na taxa exigem nova aceitação no checkout antes de criar o pedido.
- Produtos digitais exigem arquivo privado aprovado pelo ClamAV. Arquivos legados em quarentena são verificados ao publicar. Scanner indisponível ou arquivo suspeito bloqueiam a liberação. Os arquivos continuam em volume privado do Compose nesta etapa; migração para armazenamento de objetos permanece pendente.
- Cada pedido preserva a referência imutável à versão adquirida. A aprovação libera download por 12 meses. O link de acesso ao pedido é trocado por uma sessão HttpOnly, removido da URL e vale 24 horas e pode ser renovado por e-mail; o ticket direto de download é de uso único, vale 60 segundos e revalida a situação do pedido. Reembolso impede novos downloads, inclusive com tickets já emitidos. Transferências já iniciadas não podem ser recolhidas.
- O checkout físico coleta endereço sem cobrar frete. Registro de postagem e comprovantes permanecem em etapa posterior.
- Conectar Mercado Pago, split financeiro real, tarifas do gateway, webhooks externos, recorrência Pro e homologação de pagamentos reais permanecem pendentes. A aprovação manual do simulador deverá ser substituída por eventos verificados do provedor; a simulação não homologa esse comportamento externo.
