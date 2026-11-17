# Handoff — Embalagem e expedição

Estado em 17 de novembro de 2026, 17:02, hora de Lisboa. Dono: Tiago Pereira (`tiagopereira@amfshoes.com`).

## O que é

Dashboard local de embalagem e expedição da AMF. Lê um livro Excel com a folha BD (picagens) e, quando existe, um livro SHIPDATE. Mostra a semana ISO, o cumprimento, o extra-plano, a performance diária, os acumulados e um histórico editável no browser.

Stack: Vite 5, React 18, sem TypeScript. Dependências: `react`, `react-dom`, `fflate`, `xlsx`.

## Onde está o código

Repositório: https://github.com/tiagopereira-amf/Embalagem-Expedi-o

`main` está em `f74de48` (17 de novembro de 2026, 15:58, Lisboa): «Open the desk without an Excel error on this computer. (#4)».

App pública, só consulta: https://embalagem-expedicao.apps.grok.bot

Foi publicada a partir de `42c1a03`. Qualquer pessoa com o link abre, sem conta Cursor e sem `npm`. Mostra a semana gravada nessa publicação: semana 46 de 2026, rótulo «11 de novembro de 2026 às 13:45 · Lisboa». O botão Publicar no browser **não** atualiza este link. Atualizar o link exige uma nova publicação do Cursor com um `public/semana-publicada.json` novo. Não republicar sem o Tiago pedir.

## Duas cópias, não as misturar

Há duas árvores. A que o Tiago abriu no PC a 17 de novembro (localhost, «Atualizar consulta», «Ver no telemóvel», «Caminho no PC») **não** é o `main` do GitHub.

| | GitHub `main` | Cópia do projeto |
| --- | --- | --- |
| Pasta | este repositório | `docs/embalagem-expedicao/embalagem-expedicao` no store do projeto |
| Ecrã | «Guardar caminho» | «Atualizar consulta» e «Ver no telemóvel» |
| Servidor | `127.0.0.1:5173` | `host: true`, porta 5173, visível na rede Wi-Fi |
| Script | `PUBLICAR_LOCAL=1 vite` | `vite` |
| Folha BD | `scripts/atualizar-bd.ps1`, rotas `/api/ficheiro-bd` | `excel-consulta.js`, `POST /api/atualizar-consulta` |
| Plano de exemplo | `src/data/plan.json` fora do git e fora do bundle público | `src/data/plan.json` entra no bundle |

O `npm run dev` do PC do Tiago (o que mostrou `http://10.200.23.48:5173/publicado.html`) é a cópia dele, não o Vite desta máquina. Editar o GitHub não muda essa janela até ele correr o código novo.

Na cópia do projeto, a 17 de novembro, o caminho por omissão passou a ser o livro abaixo. Se o Excel falhar, a página lê o ficheiro na mesma. Essa alteração está só nessa cópia. Não está no GitHub.

## Como correr a versão do GitHub

No PC Windows, dentro do clone:

```
npm install
npm run dev
```

- Ecrã de trabalho: http://127.0.0.1:5173/
- Cópia publicada nesse computador: http://127.0.0.1:5173/publicado.html

`127.0.0.1` só abre no computador onde o comando está a correr. Para o telemóvel na mesma rede é precisa a cópia com `server.host: true`.

## Ficheiro BD

Livro no PC do Tiago:

`C:\Users\tiagopereira\OneDrive - AMF Shoes, lda\Ambiente de Trabalho\Expedição_Embalagem_2026_light.xlsm`

No GitHub, se o browser não tiver um caminho guardado, o campo vem com este valor (`src/lib/bdLocal.js`, chave `embexp.bd.path.v1`). O caminho não entra no bundle de produção: está atrás de `import.meta.env.DEV`.

No Windows, ao abrir http://127.0.0.1:5173/, o servidor pede ao Excel para abrir o livro, refrescar, gravar, e só depois a página lê os bytes. O script é `scripts/atualizar-bd.ps1` (Excel invisível, `UpdateLinks=3`, `RefreshAll`, macros com `AutomationSecurity=1` e `EnableEvents=true`). O caminho fica em `ficheiros.local.json`, que está no `.gitignore`.

Fora do Windows, um caminho `C:\...` é válido. A página não mostra o erro «Use o caminho completo». Também não mostra erro de Excel ao abrir: esta máquina não tem o ficheiro nem o Excel. Se o browser já tinha o livro, repõe essa cópia.

O SHIPDATE continua a ser escolhido no browser. Não há caminho gravado para ele.

## Público e local

A app pública é só consulta. Quem abre o link vê a semana publicada. Não escolhe ficheiros, não publica e não substitui a semana.

No `npm run dev` do GitHub:

- `POST /api/publicar` só responde com `PUBLICAR_LOCAL=1`, pedido em loopback (`127.0.0.1`, `::1`, `::ffff:127.0.0.1`) e cabeçalho `x-publicar-token`. O token está num `<meta name="publicar-local">` do HTML de desenvolvimento. Sem isto, a resposta é 404 e o corpo não é lido.
- `GET /api/publicar` serve a última publicação. A página pública, se o GET falhar, lê `/semana-publicada.json`.
- `src/data/plan.json` está no `.gitignore`. Não voltar a metê-lo no bundle público: tem nomes de clientes, números de OP e quantidades. Foi o bloqueio da primeira publicação.

Notas de segurança ainda em aberto, o Tiago não pediu para as corrigir: quem tem o link público consegue descarregar a semana publicada e as picagens que foram gravadas nela.

## O que já entrou no `main`

1. `9848d86` — código da app.
2. `42c1a03` — página pública só de leitura. É a publicação que está no ar.
3. `28ae3d0` (#1) — ao refrescar o browser, o Excel atualiza o livro BD e só depois a página o lê.
4. `fdc04ab` (#2) — o caminho do livro acima fica preenchido quando o browser não tem outro.
5. `e2da750` (#3) — `C:\...` e um caminho UNC contam como caminho completo mesmo quando o Node não é Windows.
6. `f74de48` (#4) — abrir a página fora do Windows não mostra o erro do Excel.

Não há checks de CI no repositório. «Verificado» nestes PR quer dizer integrado no `main`.

## Fórmulas em uso no GitHub

Já embalado = max(0, E − GR). O balão chama-se «Embalado esta semana (plano)».

Por OP, o objetivo é o Obs quando tem número e, se está vazio, Quant − GR. Expedição: falta expedir = max(0, objetivo − picagens `EMB.Expedicao`); essa conta não usa GR nem a coluna E. Embalagem: falta embalar = max(0, objetivo − picagens `EMB.Embalagem` da semana − já embalado). A percentagem de embalagem é (já embalado + embalado esta semana) ÷ objetivo, e é 0 quando o objetivo é 0. Cumprimento de expedição = min(100, realizado ÷ objetivo × 100). O que passa o objetivo, e as OPs de fora do plano, vai para o extra-plano.

Secções da folha BD: `EMB.Embalagem` e `EMB.Expedicao`. Um livro com as duas chega.

## O que ficou por fazer

- O PC do Tiago ainda pode estar a correr a cópia antiga. Enquanto o campo mostrar só `C:\Dados\BD.xlsx`, essa janela não está a ler o `.xlsm`.
- A ligação automática ao `.xlsm` só acontece com `npm run dev` no Windows onde o ficheiro e o Excel estão. Esta máquina Linux não abre o OneDrive dele.
- A app pública continua na semana de 11 de novembro de 2026, 13:45, Lisboa. Não foi republicada depois do trabalho do ficheiro BD.
- `npm audit` acusou 3 avisos (1 moderado, 2 altos). Não foram tratados.
- Na cópia do projeto, `POST /api/atualizar-consulta` e `POST /api/publicar` não têm o token de loopback do GitHub. Não publicar essa cópia na internet sem fechar isso.

## O que não fazer

- Não gerar zip, salvo pedido explícito.
- Não republicar https://embalagem-expedicao.apps.grok.bot sem pedido.
- Não voltar a incluir `src/data/plan.json` no bundle público.
- Não tratar `C:\Users\tiagopereira\OneDrive - AMF Shoes, lda\Ambiente de Trabalho\Expedição_Embalagem_2026_light.xlsm` como caminho incompleto.
- Não dizer que o botão Publicar do browser atualiza o link público.
