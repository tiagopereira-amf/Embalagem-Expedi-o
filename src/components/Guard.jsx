import { Component } from 'react';

export class Guard extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="crash">
        <p className="eyebrow">Embalagem e expedição</p>
        <h1>A leitura das picagens parou a página</h1>
        <p>{this.state.error.message || 'Erro inesperado ao tratar o ficheiro.'}</p>
        <p>O plano SHIPDATE não foi alterado. Recarregue para voltar aos cartões da semana.</p>
        <button type="button" className="primary" onClick={() => window.location.reload()}>
          Recarregar
        </button>
      </main>
    );
  }
}
