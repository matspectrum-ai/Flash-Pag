# Recovery Kit — Flash Pag

## Garantia de produto

O Recovery Kit é um mecanismo de recuperação offline. Ele não depende de e-mail, SMS, código enviado por terceiros ou perguntas de segurança.

A posse do Recovery Kit é tratada como uma credencial de alto valor. Ela permite iniciar a recuperação da conta, mas não autoriza diretamente saques, transferências, alteração de destinos financeiros ou outras operações de alto risco.

Depois de uma recuperação bem-sucedida:

1. a senha é substituída;
2. o Recovery Kit utilizado é invalidado;
3. o TOTP anterior é removido;
4. as sessões existentes são encerradas pelo Supabase Auth;
5. o backend deixa de aceitar access tokens cujo `session_id` não exista mais em `auth.sessions`;
6. o usuário precisa entrar novamente e configurar um novo autenticador TOTP.

O fluxo nunca cria uma sessão autenticada automaticamente.

## Material criptográfico

O segredo do Recovery Kit tem 256 bits gerados por `crypto/rand`.

O arquivo contém o segredo em formato binário, porque o arquivo é a própria credencial offline. Não há criptografia do segredo dentro do arquivo: adicionar uma camada de cifragem que dependesse de uma segunda senha ou de uma chave externa reduziria a autonomia do mecanismo de recuperação sem aumentar a proteção contra roubo do próprio arquivo.

O servidor possui somente `APP_MASTER_KEY_B64` e um verificador derivado do segredo:

`HMAC-SHA256(APP_MASTER_KEY_B64, "flashpag-recovery-secret-v1:" || secret)`

O arquivo também possui uma autenticação de integridade:

`HMAC-SHA256(APP_MASTER_KEY_B64, "flashpag-recovery-file-v1:" || header)`

O servidor nunca persiste o segredo bruto.

## Formato v1

O formato é binário, de tamanho fixo e rejeita campos desconhecidos ou ambíguos.

```text
0..7     magic = "FLASHPAG"
8        version = 1
9..11    reserved = zero
12..47   account_id, UUID textual canônico, 36 bytes
48..63   key_id, 128 bits aleatórios, 16 bytes
64..95   recovery secret, 256 bits, 32 bytes
96..127  HMAC-SHA256 do header, 32 bytes
```

Tamanho total: 128 bytes.

O parser rejeita tamanho incorreto, magic inválido, versão desconhecida, reserved não-zero, UUID inválido, key ID inválido e tag inválida.

O nome de arquivo é `account-recovery-<account-id>.recovery`. O nome não é segredo; a segurança está no segredo aleatório contido no arquivo.

## Estado persistido

`account_recovery_kits` contém apenas:

- `user_id`;
- `key_id`;
- `version`;
- `secret_verifier`;
- estado (`active`, `used`, `revoked`);
- timestamps de criação, rotação, uso e revogação.

`account_recovery_challenges` contém apenas um hash do token temporário e o estado da recuperação. O token em claro fica apenas no cookie HTTP-only cifrado pelo `cryptobox` durante a janela curta de recuperação.

## Rotação e uso

Criar um novo Recovery Kit revoga atomicamente o kit anterior e invalida challenges pendentes.

Uma recuperação usa um challenge com estados `verified -> consuming -> consumed`. A transição para `consuming` é protegida por atualização concorrente no banco. Enquanto estiver em `consuming`, uma falha externa de Auth pode ser repetida dentro da janela do challenge; o backend não tenta desfazer operações externas, pois elas não participam da mesma transação PostgreSQL.

A finalização é atômica: somente um challenge `consuming`, ainda válido e associado a um kit `active` pode marcar o kit como `used` e o challenge como `consumed`. Se a resposta HTTP for perdida depois da finalização, uma nova tentativa não repete a recuperação; o usuário deve tentar entrar novamente com a nova senha.

Depois de `consumed`, o kit passa a `used` e não pode iniciar outra recuperação.

## Rate limiting

O início e a conclusão da recuperação usam rate limiting persistido no PostgreSQL, separado por:

- identificador da conta;
- endereço IP.

Os identificadores armazenados no rate limiter são HMACs com domínio separado; e-mail e IP não são persistidos em claro nessa tabela.

Janela atual: 10 minutos.

- challenge: 5 por conta e 20 por IP;
- reset: 10 por conta e 30 por IP.

O rate limit é distribuído entre instâncias porque o estado fica no PostgreSQL.

## Threat model resumido

Proteções cobertas:

- Recovery Kit roubado: tratado como comprometimento da credencial; rotação e uso único reduzem persistência.
- Banco vazado: não contém o segredo bruto do kit.
- Log vazado: nenhum endpoint registra kit, segredo, senha, challenge ou token.
- Replay do kit: kit usado é invalidado.
- Replay do challenge: challenge é consumido atomicamente.
- Corrupção/tampering do arquivo: HMAC e parser estrito rejeitam o arquivo.
- Brute force: segredo de 256 bits + rate limiting distribuído.
- Enumeração: falhas de recuperação usam resposta genérica e não revelam se o identificador existe.
- Sessão roubada: access token só é aceito enquanto o `session_id` continuar ativo no Auth.
- CSRF: recuperação não depende de uma sessão autenticada e o challenge/reset usa cookie `HttpOnly`, `Secure` e `SameSite=Lax`.
- MFA antigo comprometido: todos os fatores existentes são removidos durante a recuperação.

## Limitação importante

Se o usuário perder simultaneamente a senha, o autenticador e o Recovery Kit, o sistema não possui uma cópia secreta para recuperar a conta automaticamente. Isso é intencional: não existe um mecanismo secreto de recuperação armazenado pelo Flash Pag.
