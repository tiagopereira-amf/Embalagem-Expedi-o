export function HistoricoView({ rows, onChange, onDelete, onSave, note, weekKey }) {
  const sorted = [...rows].sort((a, b) => b.semana.localeCompare(a.semana, 'pt'));
  return (
    <section className="view">
      <div className="weekbar">
        <p>
          <strong>Histórico editável</strong>
          <span>Uma linha por semana ISO, gravada neste browser.</span>
        </p>
        <button type="button" className="primary" onClick={onSave} data-testid="gravar-semana">
          Gravar semana
        </button>
      </div>
      <p className="formula">
        Cumprimento = min(100, realizado ÷ objetivo × 100). O objetivo de embalagem e de expedição é o Obs quando está preenchido e, se está vazio, Quant menos GR, nunca abaixo de 0.
        Realizado = soma de qtdPares das picagens com data1 na mesma semana, na secção EMB.Embalagem ou EMB.Expedicao,
        só das OPs desse plano. Gravar semana copia estas duas percentagens para a linha {weekKey}. Se o afinado ou a
        observação já tiverem texto, não são substituídos. Sem picagens, ou com objetivo 0, a percentagem não é calculada
        e as células de cumprimento que já existiam ficam como estão.
      </p>
      {note ? <p className="empty-inline" data-testid="historico-nota">{note}</p> : null}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Semana</th>
              <th>Percentagem de cumprimento de embalagem</th>
              <th>Percentagem de cumprimento de expedição</th>
              <th>Percentagem de cumprimento de expedição afinado</th>
              <th>Observação</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={6} className="chart-empty">
                  Ainda não há linhas. Use Gravar semana para abrir a semana selecionada, ou edite depois cada célula.
                </td>
              </tr>
            ) : (
              sorted.map((row) => (
                <tr key={row.id}>
                  {['semana', 'embalagem', 'expedicao', 'afinado', 'observacao'].map((field) => (
                    <td key={field}>
                      <input
                        value={row[field]}
                        aria-label={`${field} ${row.semana}`}
                        onChange={(event) => onChange(row.id, field, event.target.value)}
                      />
                    </td>
                  ))}
                  <td>
                    <button type="button" className="ghost" onClick={() => onDelete(row.id)}>
                      Apagar
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
