import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

export type LegalDoc = "terms" | "privacy";

// Campos entre [ ] têm de ser preenchidos pela empresa antes de publicar.
const COMPANY = "FUTURIX, NIF 5002502747";
const CONTACT = "geral@futurix.ao";
const UPDATED = "17 de outubro de 2026";

function S({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-extrabold text-foreground">{title}</h3>
      <div className="space-y-2 text-sm text-muted-foreground leading-relaxed">{children}</div>
    </section>
  );
}

function Terms() {
  return (
    <>
      <S title="1. Quem somos">
        <p>
          O NANTER é um jogo de Ludo online com apostas em Kwanza (Kz), operado por {COMPANY}. Ao
          criares conta ou entrares, aceitas estes Termos e a Política de Privacidade. Se não
          concordares, não uses o NANTER.
        </p>
      </S>
      <S title="2. Quem pode jogar">
        <ul className="list-disc pl-5 space-y-1">
          <li>Tens de ter 18 anos ou mais.</li>
          <li>Só podes ter uma conta, em teu nome, associada ao teu número de telemóvel.</li>
          <li>
            Podemos pedir prova de identidade e idade antes de um levantamento ou se houver suspeita
            de irregularidade.
          </li>
        </ul>
      </S>
      <S title="3. A tua conta">
        <p>
          Entras com o teu telemóvel e uma senha de 6 dígitos. És responsável por manter a senha em
          segredo e por tudo o que for feito na tua conta. Se suspeitares de acesso indevido,
          contacta-nos de imediato.
        </p>
      </S>
      <S title="4. Partidas a dinheiro">
        <ul className="list-disc pl-5 space-y-1">
          <li>A aposta é debitada da tua carteira quando crias ou entras numa sala.</li>
          <li>
            Nas salas a dinheiro, todos os adversários são jogadores humanos que pagaram a mesma
            aposta. Não há bots nestas salas.
          </li>
          <li>
            O pote é a soma das apostas dos jogadores. O vencedor recebe 95% do pote; os outros 5%
            são a taxa do NANTER.
          </li>
          <li>
            Se saíres da sala antes de o jogo começar, a aposta é reembolsada. Depois de o jogo
            começar, desistir ou sair significa perder a aposta.
          </li>
          <li>
            Tens 15 segundos para lançar o dado e 30 segundos para mover. Se o tempo acabar, o
            servidor passa a jogar por ti (modo automático) até voltares a jogar.
          </li>
          <li>O resultado e o pagamento do prémio são decididos e registados pelo servidor.</li>
        </ul>
      </S>
      <S title="5. O dado e as regras">
        <p>
          O dado é lançado no servidor e nunca no teu dispositivo, para que ninguém o possa
          manipular. O lançamento inclui mecanismos de equilíbrio aplicados da mesma forma a todos
          os jogadores, como aumentar a probabilidade de um 6 a quem está várias jogadas sem o tirar
          ou a quem está mais atrasado. Estes mecanismos não favorecem nenhum jogador em particular
          nem o NANTER.
        </p>
        <p>
          Regras principais: precisas de um 6 para tirar uma peça de casa; um 6 ou uma captura dão
          direito a jogar outra vez; três 6 seguidos fazem-te perder a vez; as casas seguras
          protegem as peças de ser comidas; ganha quem levar primeiro as 4 peças ao fim.
        </p>
      </S>
      <S title="6. Treino contra bots">
        <p>
          O modo de treino é grátis e não envolve dinheiro, bónus, missões nem ranking. Os bots
          estão sempre identificados como "Bot".
        </p>
      </S>
      <S title="7. Saldo bónus, missões e ranking semanal">
        <ul className="list-disc pl-5 space-y-1">
          <li>
            O saldo bónus vem de missões e prémios do ranking. Serve para apostar e para a loja, mas
            não pode ser levantado nem transferido.
          </li>
          <li>
            Nas apostas, o bónus é usado primeiro. A parte de um prémio que corresponde a apostas
            feitas com bónus é paga em bónus.
          </li>
          <li>
            As missões diárias renovam à meia-noite (hora de Luanda) e só contam partidas a
            dinheiro. O prémio tem de ser recebido no próprio dia.
          </li>
          <li>
            O ranking semanal conta vitórias em partidas a dinheiro de segunda a domingo (hora de
            Luanda). Os 3 primeiros recebem o prémio em bónus indicado na app.
          </li>
          <li>
            Podemos anular bónus, posições no ranking e prémios obtidos com batota, conluio ou
            contas múltiplas.
          </li>
        </ul>
      </S>
      <S title="8. Loja e presentes">
        <p>
          Os itens da loja (por exemplo, molduras de avatar) são apenas visuais, não dão vantagem no
          jogo, não têm valor monetário e não são reembolsáveis. Os presentes (gifts) enviados no
          chat transferem o valor indicado do teu saldo para o jogador escolhido e não podem ser
          anulados.
        </p>
      </S>
      <S title="9. Depósitos e levantamentos">
        <p>
          Os depósitos e levantamentos são feitos pelos métodos disponíveis na app, com os limites e
          prazos lá indicados. Só o saldo real pode ser levantado. Podemos reter um levantamento
          enquanto verificamos a identidade ou investigamos uma irregularidade.
        </p>
      </S>
      <S title="10. Conduta proibida">
        <ul className="list-disc pl-5 space-y-1">
          <li>Combinar resultados com outros jogadores, incluindo desistir de propósito.</li>
          <li>Ter ou usar mais de uma conta, ou jogar com a conta de outra pessoa.</li>
          <li>Usar programas, scripts ou qualquer automatismo para jogar.</li>
          <li>Explorar erros da plataforma em vez de os comunicar.</li>
          <li>Insultar, assediar, fazer spam ou partilhar conteúdo ilegal no chat.</li>
        </ul>
        <p>
          Podemos suspender ou encerrar contas, anular partidas, prémios e bónus, e reter fundos
          enquanto investigamos. Os jogadores podem denunciar comportamentos na app.
        </p>
      </S>
      <S title="11. Jogo responsável">
        <p>
          Joga apenas com dinheiro que podes perder e faz pausas. O jogo não é forma de ganhar a
          vida nem de recuperar perdas. Se sentires que estás a perder o controlo, contacta-nos em{" "}
          {CONTACT} para definir limites ou excluir a tua conta temporária ou definitivamente.
        </p>
      </S>
      <S title="12. Falhas técnicas">
        <p>
          Se uma partida for afectada por uma falha do nosso lado, podemos anulá-la e devolver as
          apostas. Não somos responsáveis por falhas da tua ligação à internet ou do teu
          dispositivo; nesses casos o modo automático continua a jogar por ti.
        </p>
      </S>
      <S title="13. Responsabilidade">
        <p>
          O NANTER é fornecido tal como está. Na medida permitida por lei, não respondemos por
          perdas indirectas nem por interrupções do serviço fora do nosso controlo.
        </p>
      </S>
      <S title="14. Alterações e lei aplicável">
        <p>
          Podemos alterar estes Termos; avisamos na app antes de as alterações importantes entrarem
          em vigor. Estes Termos regem-se pela lei angolana, incluindo a Lei da Actividade de Jogos
          (Lei n.º 5/16). Qualquer litígio é resolvido nos tribunais de Luanda.
        </p>
      </S>
      <S title="15. Contactos">
        <p>{CONTACT}</p>
      </S>
    </>
  );
}

function Privacy() {
  return (
    <>
      <S title="1. Responsável pelos dados">
        <p>
          {COMPANY} é responsável pelo tratamento dos teus dados pessoais no NANTER, nos termos da
          Lei n.º 22/11 (Lei da Protecção de Dados Pessoais). Contacto: {CONTACT}.
        </p>
      </S>
      <S title="2. Que dados recolhemos">
        <ul className="list-disc pl-5 space-y-1">
          <li>
            Conta: número de telemóvel, senha (guardada cifrada, nunca em texto) e data do último
            acesso.
          </li>
          <li>
            Perfil: nome de jogador, foto de perfil (se a carregares), nível, XP e itens da loja.
          </li>
          <li>
            Carteira: saldo, saldo bónus e histórico de depósitos, apostas, prémios, presentes e
            compras.
          </li>
          <li>Jogo: partidas, jogadas, resultados, desistências, missões e posição no ranking.</li>
          <li>Comunicação: mensagens e presentes enviados no chat das partidas.</li>
          <li>Denúncias: denúncias que fazes ou que são feitas sobre ti, e a decisão tomada.</li>
          <li>
            Documentos de identificação, se os pedirmos para verificar a idade ou um levantamento.
          </li>
        </ul>
      </S>
      <S title="3. Para que usamos os dados">
        <ul className="list-disc pl-5 space-y-1">
          <li>Criar e proteger a tua conta.</li>
          <li>Fazer funcionar as partidas, a carteira, os prémios, as missões e o ranking.</li>
          <li>Prevenir fraude, batota, contas múltiplas e branqueamento de capitais.</li>
          <li>Moderar o chat e tratar denúncias.</li>
          <li>Cumprir obrigações legais, fiscais e regulatórias.</li>
          <li>Melhorar o jogo com estatísticas agregadas.</li>
        </ul>
        <p>Não vendemos os teus dados e não os usamos para publicidade de terceiros.</p>
      </S>
      <S title="4. O que os outros jogadores veem">
        <p>
          O teu nome de jogador, foto, moldura e nível; as tuas mensagens e presentes no chat das
          partidas em que jogas; e, se ficares no top, o teu nome, vitórias e valor ganho no ranking
          semanal. O teu número de telemóvel nunca é mostrado a outros jogadores.
        </p>
      </S>
      <S title="5. Com quem partilhamos">
        <p>
          Só com prestadores que nos ajudam a operar o serviço (alojamento e, quando existirem,
          pagamentos), obrigados a proteger os dados, e com autoridades quando a lei o exigir,
          incluindo o regulador do jogo.
        </p>
      </S>
      <S title="6. Quanto tempo guardamos">
        <p>
          Os dados da conta enquanto ela estiver activa. O histórico financeiro e de partidas
          durante o prazo exigido pelas obrigações legais e fiscais ([PRAZO]). As mensagens de chat
          durante [PRAZO]. Depois disso, os dados são apagados ou anonimizados.
        </p>
      </S>
      <S title="7. Segurança">
        <p>
          As senhas são guardadas com hash, o acesso aos dados é restrito e as sessões podem ser
          terminadas no servidor ao saíres. Nenhum sistema é infalível: escolhe uma senha difícil de
          adivinhar e não a partilhes.
        </p>
      </S>
      <S title="8. Os teus direitos">
        <p>
          Podes pedir acesso, correcção ou eliminação dos teus dados, opor-te a um tratamento ou
          pedir a portabilidade, escrevendo para {CONTACT}. Alguns dados têm de ser guardados por
          obrigação legal, mesmo depois de fechares a conta. Podes também apresentar queixa à
          Agência de Protecção de Dados (APD).
        </p>
      </S>
      <S title="9. Armazenamento no teu dispositivo">
        <p>
          Guardamos no navegador apenas o token da tua sessão e a tua preferência de som. Não usamos
          cookies de publicidade nem de rastreamento.
        </p>
      </S>
      <S title="10. Menores">
        <p>
          O NANTER não se destina a menores de 18 anos. Se soubermos que uma conta pertence a um
          menor, encerramo-la.
        </p>
      </S>
      <S title="11. Alterações">
        <p>
          Podemos actualizar esta política; avisamos na app quando as mudanças forem importantes.
        </p>
      </S>
    </>
  );
}

export function LegalModal({ doc, onClose }: { doc: LegalDoc | null; onClose: () => void }) {
  useEffect(() => {
    if (!doc) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doc, onClose]);

  if (!doc) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="legal-title"
    >
      <div
        className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <h2 id="legal-title" className="font-extrabold text-foreground">
              {doc === "terms" ? "Termos de Uso" : "Política de Privacidade"}
            </h2>
            <p className="text-[11px] text-muted-foreground">Última actualização: {UPDATED}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-white/5"
            aria-label="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4 space-y-5">
          {doc === "terms" ? <Terms /> : <Privacy />}
        </div>
      </div>
    </div>
  );
}
