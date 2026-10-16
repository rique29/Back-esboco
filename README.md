# Back-esboco

# NIX Core — Backend

API Node.js (Express) + Supabase (Postgres) rodando em Docker.

> A documentação completa (endpoints, modelo de dados, segurança, solução de problemas) está no
> Claude Doc entregue junto com este projeto. Abaixo, o essencial para rodar.

## Subir o ambiente do zero

```bash
npm install                                  # (opcional) para o VS Code reconhecer as bibliotecas
npx supabase start                           # sobe o Supabase local (Docker precisa estar aberto)
npx supabase db reset                        # cria as tabelas (as 2 migrations) e os dados iniciais
npx supabase status -o env                   # copie a SERVICE_ROLE_KEY/SECRET_KEY para o .env
cp .env.example .env                         # (Windows: copy .env.example .env) e preencha
docker compose up --build                    # sobe a API em http://localhost:3000
docker compose exec api npm run seed         # cria os 3 usuários e 2 equipamentos de teste
docker compose exec api npm run test:e2e     # roda os 60+ testes de ponta a ponta
```

Teste rápido: http://localhost:3000/health  →  `{"api":"ok","banco":"ok",...}`

## Usuários de teste (criados pelo seed)

| Perfil   | E-mail                  | Código | Senha          |
|----------|-------------------------|--------|----------------|
| GESTOR   | gestor@nixcore.test     | G001   | Gestor@123     |
| OPERADOR | operador1@nixcore.test  | O001   | Operador@123   |
| OPERADOR | operador2@nixcore.test  | O002   | Operador@123   |

O código 2FA aparece no log da API (`docker compose logs api`) e, em desenvolvimento,
também no campo `codigo_dev` da resposta do login.

## Testar no VS Code

Instale a extensão **REST Client** (humao.rest-client), abra `requests.http` e clique em
"Send Request" acima de cada requisição.

## Comandos úteis

| Comando | O que faz |
|---|---|
| `npx supabase db reset` | Recria o banco do zero (apaga dados; depois rode o seed de novo) |
| `npx supabase stop` / `start` | Desliga / liga o Supabase local |
| `docker compose down` | Para a API |
| `docker compose down -v && docker compose up --build` | Reinstala dependências (após mudar o package.json) |
| `docker compose logs -f api` | Acompanha o log da API |
| `docker compose restart api` | Reinicia a API (se o auto-reload não detectar mudanças no Windows) |
>>>>>>> 5673e55 (Update do Back)

