# nostore

A nostore permite vender produtos por checkouts individuais, com recebimento pelo vendedor e entrega física ou digital ao comprador. Este glossário define a linguagem do negócio; regras e detalhes técnicos ficam na especificação.

## Language

### Participantes e contas

**Usuário da plataforma**:
Pessoa com acesso autenticado à nostore para operar uma conta vendedora ou administrar a plataforma.
_Avoid_: Cliente, comprador como sinônimos de usuário da plataforma.

**Vendedor**:
Pessoa física ou jurídica responsável pela oferta do produto e pelo cumprimento da venda ao comprador.
_Avoid_: Cliente, usuário quando a referência for à responsabilidade pela venda.

**Conta vendedora**:
Espaço de negócio do vendedor na nostore, ao qual pertencem produtos, vendas e benefícios do plano.
_Avoid_: Conta bancária, conta Mercado Pago, login como sinônimos.

**Comprador**:
Pessoa que adquire um produto de um vendedor por um checkout da nostore, sem precisar de cadastro na plataforma.
_Avoid_: Cliente, usuário quando a referência for a quem compra o produto.

**Recebedor**:
Participante reconhecido pelo provedor de pagamento como destinatário de uma parcela da venda.
_Avoid_: Conta bancária, vendedor como equivalentes em todos os casos.

**Conta de pagamento**:
Conta mantida junto ao provedor de pagamento para processar ou receber valores.
_Avoid_: Conta vendedora, conta bancária.

**Conta bancária de recebimento**:
Conta bancária indicada para recebimento dos recursos conforme as condições do provedor de pagamento.
_Avoid_: Recebedor, conta vendedora.

**Conexão Mercado Pago**:
Autorização, feita por OAuth em Recebimento, pela qual o vendedor vincula sua conta de pagamento à nostore; pré-requisito para publicar e manter produtos à venda.
_Avoid_: Credenciais do gateway, conta vendedora, cadastro de dados bancários.

### Oferta e entrega

**Produto**:
Oferta física ou digital de um vendedor, com identificação, descrição, preço e checkout próprio.
_Avoid_: Loja, arquivo, pedido como sinônimos.

**Produto ativo**:
Produto publicado que ocupa uma posição no limite de produtos ativos da conta vendedora; a possibilidade de compra também depende das demais condições de venda.
_Avoid_: Produto cadastrado, produto com vendas.

**Produto pausado**:
Produto retirado de venda pelo vendedor para edição; não ocupa posição no limite e volta a vender ao ser publicado novamente.
_Avoid_: Produto suspenso, rascunho, produto excluído.

**Pacote digital**:
Conjunto ordenado de arquivos (PDF, EPUB ou ZIP) que compõe um produto digital; com mais de um arquivo, o comprador recebe tudo em um único ZIP.
_Avoid_: Arquivo do produto, anexo, produto como sinônimo de cada arquivo.

**Personalização de PDF**:
Opção do produto que carimba nome e CPF/CNPJ do comprador no rodapé de cada página dos PDFs no momento do download.
_Avoid_: Marca d'água de segurança, proteção contra cópia, DRM.

**Varredura de arquivo**:
Verificação antivírus dos arquivos enviados pelo vendedor antes de ficarem disponíveis; pode estar desativada por configuração do ambiente.
_Avoid_: Moderação de conteúdo, aprovação do produto.

**Checkout do produto**:
Fluxo compartilhável de identificação do comprador e pagamento de um produto específico.
_Avoid_: Loja virtual, carrinho, pedido.

**Versão digital adquirida**:
Edição do arquivo digital associada à oferta no momento em que o pedido é criado.
_Avoid_: Arquivo atual do produto, última versão.

**Direito de download**:
Direito do comprador de obter a versão digital adquirida enquanto a compra permanecer paga; um reembolso o encerra.
_Avoid_: Arquivo público, acesso incondicional, link de checkout.

**Link de acesso ao pedido**:
Meio para o comprador acessar as informações e entregas autorizadas de seu pedido: válido por 24 horas enquanto o pedido aguarda pagamento e permanente após a confirmação.
_Avoid_: Direito de download, link de checkout.

**Link de download direto**:
Endereço permanente, enviado por e-mail na confirmação do pagamento, que entrega o pacote digital adquirido sem passar pela página do pedido; tem o mesmo valor de acesso que o link do pedido.
_Avoid_: Link público do arquivo, link de checkout.

**Envio físico**:
Postagem declarada pelo vendedor, acompanhada de rastreio ou comprovante.
_Avoid_: Entrega confirmada, recebimento pelo comprador.

### Venda e valores

**Pedido**:
Registro de uma intenção de compra de um produto por um comprador, com suas condições comerciais preservadas.
_Avoid_: Pagamento, venda paga, transação como sinônimos.

**Tentativa de pagamento**:
Iniciativa de cobrança para quitar um pedido, que pode ser aprovada, recusada ou permanecer sem resultado definitivo.
_Avoid_: Novo pedido, pagamento confirmado.

**Pagamento confirmado**:
Cobrança reconhecida como aprovada pelo provedor e validada pela nostore para o pedido correspondente.
_Avoid_: Pedido criado, comprovante enviado pelo comprador, saldo disponível.

**Venda paga**:
Pedido cuja cobrança foi confirmada, com eventuais reembolsos ou chargebacks identificados separadamente.
_Avoid_: Tentativa de pagamento, pedido pendente.

**Taxa de serviço nostore**:
Remuneração da plataforma por venda, calculada pelo percentual configurado sobre a base definida na política comercial.
_Avoid_: Mensalidade Pro, tarifa do gateway.

**Tarifa do gateway**:
Custo cobrado pelo provedor de pagamento conforme suas condições comerciais.
_Avoid_: Taxa de serviço nostore, mensalidade.

**Split da venda**:
Divisão do pagamento do produto entre o recebedor do vendedor e a nostore.
_Avoid_: Saque, depósito bancário imediato, cobrança da assinatura Pro.

**Parcela nominal do vendedor**:
Parte do valor da venda atribuída ao vendedor antes dos custos e ajustes aplicáveis do provedor.
_Avoid_: Líquido confirmado, saldo disponível.

### Plano da conta

**Plano da conta**:
Conjunto de benefícios da conta vendedora, incluindo o limite de produtos ativos, nas modalidades Gratuito ou Pro.
_Avoid_: Assinatura, produto vendido ao comprador.

**Assinatura Pro**:
Contratação recorrente do plano pago da própria nostore pelo vendedor.
_Avoid_: Assinatura do produto, pedido do comprador, split da venda.

**Mensalidade Pro**:
Valor de R$ 29,90 cobrado por mês pela assinatura Pro, separado da taxa de serviço por venda.
_Avoid_: Taxa de serviço nostore, tarifa do gateway.

**Cancelamento da renovação**:
Interrupção das futuras renovações da assinatura Pro, preservando os benefícios do período já pago conforme a política aplicável.
_Avoid_: Reembolso, downgrade imediato, exclusão da conta.

**Downgrade**:
Retorno da conta vendedora aos benefícios e limites do plano Gratuito.
_Avoid_: Suspensão do vendedor, exclusão dos produtos, cancelamento dos pedidos.

### Pós-venda e moderação

**Cancelamento do pedido**:
Encerramento de um pedido sem pagamento confirmado; uma cobrança confirmada exige tratamento financeiro próprio.
_Avoid_: Reembolso, cancelamento da renovação.

**Reembolso**:
Devolução de um pagamento pelo fluxo do provedor, referente a uma compra de produto ou a uma mensalidade identificada.
_Avoid_: Cancelamento, estorno sem identificar se é reembolso ou chargeback.

**Disputa de pagamento**:
Contestação formal de uma cobrança ainda sujeita a análise no fluxo do provedor de pagamento.
_Avoid_: Reclamação de atendimento, chargeback concluído.

**Chargeback**:
Reversão de uma cobrança em decorrência de contestação no meio de pagamento.
_Avoid_: Reembolso voluntário, reclamação de atendimento.

**Reclamação de atendimento**:
Manifestação registrada sobre um problema com uma compra ou com o serviço da nostore.
_Avoid_: Disputa de pagamento, chargeback como sinônimos automáticos.

**Análise de suspensão**:
Avaliação fundamentada da conduta de um vendedor, motivada por indicadores ou evidências de risco.
_Avoid_: Suspensão automática, condenação por reclamação.

**Suspensão do vendedor**:
Medida que impede novas vendas e publicações, preservando o atendimento e as obrigações de pedidos existentes.
_Avoid_: Downgrade, confisco de saldo, exclusão da conta.

**Pagamento simulado**:
Resultado de teste que reproduz os estados de uma cobrança sem movimentar dinheiro.
_Avoid_: Pagamento real, recebimento bancário, homologação do gateway.

**Ambiente de demonstração**:
Instalação em produção na qual os pagamentos simulados foram liberados por decisão explícita; cada tela e e-mail avisa que nenhum valor é cobrado.
_Avoid_: Sandbox do provedor, ambiente de teste do Mercado Pago.

**Notificação do provedor**:
Aviso enviado pelo provedor de pagamento sobre a mudança de uma cobrança; a nostore registra o aviso, confere sua assinatura e consulta a cobrança antes de alterar o pedido.
_Avoid_: Pagamento confirmado por si só, retorno do checkout.
