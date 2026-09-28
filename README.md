# Palitinho Poker

Jogo do Palitinho (Purrinha) online, mesa de boteco, até 20 jogadores, celular e computador.

## Visual

Mesinha amarela de fórmica com friso metálico (a mesa de boteco de verdade), num cenário de boteco em **3D real** ao fundo: balcão desgastado, prateleira com garrafas de pinga, uma cerveja com copos americanos numa pontinha do balcão e um cachorro de rua caramelo dormindo num canto — tudo com luz, sombra e reflexo de verdade (WebGL via Three.js), sempre em segundo plano para não roubar a cena da mesa.

- `public/scene3d.js` monta a cena (câmera, luz de boteco, garrafas, balcão, cachorro) num `<canvas>` atrás da mesa. Texturas (madeira, fórmica, desenho do cachorro) são geradas na hora em `<canvas>` 2D — nenhuma imagem externa, nenhuma rede.
- `public/vendor/three.module.min.js` é o Three.js já empacotado num único arquivo (via `esbuild --bundle`), então o site continua sem build step e sem CDN.
- Se o aparelho não tiver WebGL, a cena 3D simplesmente não aparece e sobra o gradiente escuro do `.bar-back` — o jogo continua funcionando normal (mesa e placar não dependem disso).
- O campo de visão da câmera se ajusta pela proporção da tela (`public/scene3d.js`, `HALF_H_DEG`) pra garrafas e cachorro não sumirem no celular em pé.
- Baseado em fotos reais de boteco: cadeiras de plástico amarelas e vermelhas misturadas (`.chair-yellow`/`.chair-red` em `public/style.css`, alternadas por assento em `public/app.js`), piso de ladrilho quadriculado e garrafa com isopor amarelo no balcão (`bottleWithKoozie` em `public/scene3d.js`).

Cada jogador escolhe um avatar (10 opções, geradas na hora em SVG, sem imagem externa) antes de entrar na mesa; a escolha fica salva no navegador e aparece pra todo mundo na mesa.

## Deploy (jogar online com os amigos)

O servidor já respeita `process.env.PORT` e só tem uma dependência (`ws`) — sobe em qualquer host Node com WebSocket.

Caminho grátis (Render): suba este projeto pra um repositório no GitHub e, no Render, use **New + → Blueprint** apontando pro repo — ele lê o `render.yaml` daqui e configura build/start sozinho. Sem `render.yaml`, configure manualmente: Environment `Node`, Build Command `npm install`, Start Command `npm start`. O plano free "dorme" depois de 15 min sem acesso (demora uns 30-50s pra acordar no primeiro acesso do dia); pra ficar sempre ligado, é só trocar pro Railway ou um VPS pago mais pra frente — nada no código muda.

Depois do deploy: crie a mesa na URL pública, clique em "Mesa XXXX ⧉" pra copiar o link (o código já vem preenchido pra quem abrir) e manda pro grupo.

## Rodar

```
npm install
npm start          # http://localhost:3000
npm run sim        # simula 500 partidas com 20 bots e confere as regras
npm test           # teste ponta a ponta pelo WebSocket
```

## Mesa do tamanho do grupo

A mesa só tem lugar para quem entrou: 3 amigos = mesa de 3, 5 = mesa de 5, até 20. Os jogadores ficam igualmente espaçados em volta e os lugares crescem quando são poucos. Bots são opcionais (botão "+ Bot" do dono da mesa).

Para jogar com amigos de fora da sua rede, o servidor precisa estar hospedado
(qualquer host que rode Node com WebSocket: Render, Railway, Fly.io, VPS). A porta vem de `PORT`.

## A regra, em uma frase

Não é um jogo de quem ganha mais — é de quem erra menos. Todo mundo joga até sobrar um único jogador na roda: **esse é quem perde a partida**. Não há empate nem campeão; o resto só "se safou".

## Estilos de jogo (o dono da mesa escolhe no lobby, antes de iniciar)

Os dois estilos são a mesma estrutura — jogar até sobrar um só — mudando apenas quantos acertos livram um jogador da roda:

- **Descer palito**: quem acerta a soma desce 1 palito da mão. Ao zerar os palitos, está salvo e sai da roda; quem ainda tem palito continua jogando. Bom para poucos jogadores (uma partida de 4-6 jogadores com 3 palitos dura ~15-20 rodadas).
- **No tiro**: quem acerta já sai da roda na hora (1 acerto = salvo). Rodadas bem mais rápidas — bom para muita gente na mesa.

Todo mundo começa com 3 palitos, sempre — não dá mais pra escolher outra quantidade. A LONA proibida na 1ª rodada vale nos dois estilos.

O dono também pode ajustar, ainda no lobby, quanto tempo cada fase dura (segundos pra escolher os palitos e segundos pra palpitar), e ligar/desligar o piloto automático persistente (ver seções abaixo).

## "Cantou ferrado"

Quando o primeiro a palpitar na rodada já acerta a soma em cima, sem sobrar chance pra mais ninguém — não importa se alguém já tinha saído da roda antes —, isso é "cantar ferrado", o equivalente a "acertar na lata". Não influencia nenhuma regra nem resultado: é só para o ego, e aparece no histórico e no placar como curiosidade (🔥).

## Placar e troféus

O placar vale enquanto a mesa existir e soma **rodadas**, não partidas: cada rodada em que um jogador não acerta a soma conta como um erro. É esse número acumulado, rodada após rodada e partida após partida, que decide quem é o melhor e o pior da mesa.

- 🏆 **Troféu Palito de Ouro**: quem tem **menos** erros de rodada acumulados.
- 📛 **Troféu Serasa**: quem tem **mais** erros de rodada acumulados — o nome mais sujo da mesa. "Nome limpo" é não ter ficado por último em nenhuma partida ainda (não importa se a pessoa se salvou em 1º, 2º ou 3º — o que importa é nunca ter sido a última). Enquanto alguém segue limpo, o resto da mesa corre atrás pra sujar o nome dele também, só na brincadeira — e isso vale a sessão toda, que às vezes passa de 80 partidas em volta da mesa.
- O placar também guarda: partidas jogadas, rodadas jogadas, acertos, vezes que sobrou por último (perdeu a partida) e quantas vezes cantou ferrado.
- O dono da mesa pode zerar o placar quando quiser. Se o servidor reiniciar, o placar também zera (fica só na memória, enquanto a mesa existir).
- **Troféu ao vivo é só quando não tem empate.** Durante o jogo, um troféu (Ouro ou Serasa) só aparece pendurado em alguém quando essa pessoa é a ÚNICA no topo (ou na base); com dois ou mais empatados, ninguém carrega o troféu até o empate se desfazer. Isso vale pro placar consultado a qualquer momento e pros ícones na mesa.

## Parar por hoje (encerramento por consenso)

Qualquer jogador sentado pode marcar "Quero parar por hoje" (no placar). Quando **todo mundo** que está sentado, conectado e não é bot já marcou, a mesa toda recebe uma cerimônia de encerramento: os troféus finais (Ouro e Serasa), dessa vez **sem filtro de empate** — mostrando todo mundo que estiver empatado no topo ou na base, o resultado honesto da sessão. Se alguém sai da mesa no meio da votação, o consenso é recalculado só com quem ficou, então uma pessoa saindo não trava as demais.

## Arquitetura

| Arquivo | Papel |
|---|---|
| `engine.js` | Regras puras (sem rede, sem timer). Única fonte da verdade. Lança `GameError` em jogada ilegal. |
| `bots.js` | Bots com 5 personalidades. Usam só informação pública + a própria mão. |
| `server.js` | HTTP estático + WebSocket. Salas, prazos de jogada, piloto automático, reconexão, placar. |
| `public/` | Cliente (HTML/CSS/JS puro). Só desenha o que o servidor manda. |
| `tools/sim.js` | Simulador de partidas + verificação de invariantes + estatísticas. `node tools/sim.js [partidas] [jogadores] [descer\|notiro]`. |
| `tools/humans.js` | Teste ponta a ponta só com humanos (sem bots), confere placar. `node tools/humans.js [jogadores] [descer\|notiro]`. |
| `tools/smoke.js` | Teste ponta a ponta com 20 jogadores (3 humanos + bots) e uma sala demo. |

Decisões que importam:

- **Servidor autoritativo.** A mão de cada jogador fica só no servidor. `view(seat)` só entrega a mão do próprio jogador; as demais só aparecem na revelação. O smoke test confere que nada vaza.
- **Um só modelo por trás dos dois estilos.** Internamente, tanto "descer" quanto "no tiro" são "jogar até sobrar um só na roda" (`playingSeats().length <= 1`); a única diferença é quantos acertos tiram alguém da roda (1 para no tiro, `startSticks` para descer). Isso elimina qualquer heurística de desempate: o motor sempre sabe exatamente quem perdeu.
- **LONA na 1ª rodada** é barrada no motor (`minPick()`), então nenhum cliente adulterado consegue burlar.
- **Palpites** só aceitam valores possíveis (entre a soma mínima e máxima da rodada) e nunca repetidos. Como sempre há mais valores possíveis que jogadores, ninguém fica sem palpite legal.
- **Ordem de palpite gira** a cada rodada. A simulação mostra que quem palpita primeiro acerta bem mais que o último, então girar é essencial.
- **Tempo:** 20 s para escolher, 15 s para palpitar, por padrão — o dono da mesa pode ajustar esses dois prazos no lobby (5-60 s pra escolher, 5-45 s pra palpitar), antes de iniciar. Estourou o prazo, joga por você (uma jogada aleatória/padrão, pra não travar o jogo).
- **Piloto automático persistente é opcional e vem desligado.** Por padrão, cada vez que o prazo estoura o jogo só joga aquela jogada por você; não existe mais um modo "grudento" que assume o jogador de vez. O dono da mesa pode ligar o piloto automático persistente no lobby (duas jogadas perdidas seguidas aí sim ativam o modo, até a pessoa clicar "Voltei").
- **Reconexão:** o token fica no navegador; recarregar a página devolve o mesmo lugar.
- **Sair no meio da partida:** um bot assume a mão.

## Resultados da simulação (300 partidas, bots)

| Jogadores | Estilo | Rodadas por partida (média) |
|---|---|---|
| 6 | Descer (3 palitos) | ~20 |
| 20 | Descer (3 palitos) | ~61 |
| 6 | No tiro | ~8 |
| 20 | No tiro | ~24 |

Nenhuma invariante quebrou: LONA sempre barrada na rodada 1, nunca mais de um acerto por rodada, exatamente um perdedor por partida, soma sempre correta.

## Próximos passos possíveis

Ranking e contas, fichas/apostas por partida, emotes e chat, sons, mesas privadas com senha, modo torneio, placar separado por estilo.
