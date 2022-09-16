import { html, css, LitElement } from 'lit';

class CasperNotFound extends LitElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      /* background: black; */
      width: 100%;
      height: 100vh;
      fill: white;
    }
    h1 {
      color: var(--default-primary-color);
      margin: 0;
      padding: 50px;
    }
  `;

  constructor () {
    super();
  }

  render () {
    return html`
      <div>
        <h1>Página não encontrada</h1>
      </div>
    `;
  }
}
window.customElements.define('casper-not-found', CasperNotFound);
