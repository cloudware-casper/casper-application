import { html, css, LitElement } from 'lit';
import { CasperSocket } from '@cloudware-casper/casper-socket/casper-socket.js';
import { CasperBroker } from '@cloudware-casper/casper-broker/casper-broker.js';
import { CasperBrowser } from '@cloudware-casper/casper-utils/casper-utils.js';

import '@cloudware-casper/casper-print-dialog/casper-print-dialog.js';
import '@cloudware-casper/casper-tooltip/casper-tooltip.js';
import '@cloudware-casper/casper-toast/casper-toast.js';
import '@cloudware-casper/casper-timed-status/casper-timed-status.js';
import '@cloudware-casper/casper-pages/casper-pages.js';

import './components/casper-not-found.js';

export class CasperApplication extends LitElement {

  static properties = {
    _state: {
      type: String,
      state: true
    },
    _message: {
      type: String,
      state: true
    },
    _progress: {
      type: Number,
      state: true
    },
    _url: {
      type: String,
      state: true
    },
    digest: {
      type: String
    },
    digest_menu: {
      type: String
    },
    page: {
      type: String
    }
  }
  
  static styles = [
    css`
      :host {
        position: fixed;
        top: 0;
        left: 0;
        height: 100vh;
        width: 100vw;
        display: flex;
        flex-direction: column;
        font-family: var(--default-font-family);
        color: var(--primary-text-color);
      }

      [hidden] {
        display: none !important;
      }

      casper-timed-status {
        place-self: center;
        width: 150px;
        height: 150px;
        --casper-timed-status-ring-color: #FFF;
        --casper-timed-status-progress-color: var(--primary-color);
        --casper-timed-status-countdown-color: #444;
        --casper-timed-status-timeout-color: transparent;
      }

      h1 {
        font-size: 1.25rem;
        font-weight: 700;
        text-align: center;
        max-width: 300px;
      }

      .fillall {
        height: 100%;
      }

      .overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        display: flex;
        justify-content: center;
        flex-direction: column;
        align-items: center;
        gap: 1rem;
        color: #FFF;
        background-color: rgba(0, 0, 0, 0.5);
        box-shadow: inset 0px 0px 40px -10px rgba(0, 0, 0, 0.2);
        z-index: 999;
      }
    `
  ];

  get applicationLoaded () {
    if (!this._applicationLoadedPromises)
      this._applicationLoadedPromises = [];
    if (this._state === 'ready') {
      return new Promise((resolve, reject) => resolve());
    } else {
      return new Promise((resolve, reject) => this._applicationLoadedPromises.push({ resolve: resolve, reject: reject }));
    }
  }

  get cdbUrl () {
    if (this._cdbUrl === undefined) {
      try {
        this._cdbUrl = this.session.app.config.cdb_api;
      } catch (e) {
        this.app.openToast({
          text: `Dados de sessão inválida, faça novo login ${e}`,
          backgroundColor: 'var(--status-red)'
        });
      }
    }
    return this._cdbUrl;
  }

  // Override this to get different menus
  get menuRoute () {
    if (!this.session) return '';
    const menuDigest = !this.digest_menu ? '' : `${this.digest_menu}.`;
    return `/static/navigation/pt/${menuDigest}menu_${this.session.role_mask}.json`;
  }

  get loginLocation () {
    return '/login';
  }

  get useLocalStorage () {
    return false;
  }

  constructor () {
    super();
    window.app = this;

    this.socket = new CasperSocket();
    this.socket.useLocalStorage = this.useLocalStorage;
    this.socket.userActivity();
    this.socket.app = this;

    this.socket2 = new CasperSocket();
    this.socket2.useLocalStorage = this.useLocalStorage;
    this.socket2.userActivity();
    this.socket2.secondary = true;   
    this.socket2.app = this;

    this.broker = new CasperBroker();
    this.apiBaseUrl = '/api';

    this._state = 'connecting';
    this._message = 'A estabelecer ligação ao servidor';
    this._timeout = 25;

    this._debounceTimeout = 1;
    this._debounceTimerId = undefined;

    this._urlMap = new Map();

    this.baseUrl = new URL(document.baseURI).pathname;

    this._updateLocation(window.location);
    
    this._init();
  }

  //***************************************************************************************//
  //                                ~~~ LIT life cycle ~~~                                 //
  //***************************************************************************************//

  render () {
    if (this._state !== 'ready') {
      return html`
        <div class="overlay">
          <casper-timed-status
            id="status"
            state=${this._state}
            timeout=${this._timeout}
            progress=${this._progress}>
          </casper-timed-status>
          <h1>${this._message}</h1>
        </div>
      `;
    } else {
      return html`
        <casper-pages id="pages" .selected=${this.page}>
          <casper-not-found name="notfound404" class="fillall"></casper-not-found>
        </casper-pages>
      `;
    }
  }

  async firstUpdated () {
    await this.applicationLoaded;

    this.pages = this.shadowRoot.getElementById('pages');
  }

  updated (changedProperties) {
    if (changedProperties.has('_url')) {
      this._urlChanged();
    }
    if (changedProperties.has('_state') && this._state === 'ready') {
      if (this._applicationLoadedPromises && this._applicationLoadedPromises.length > 0) {
        this._applicationLoadedPromises.forEach(promise => promise.resolve());
        this._applicationLoadedPromises = [];
      }
    }
  }

  async _init () {
    await this.updateComplete;

    this.broker.apiBaseUrl = `${window.location.origin}${this.apiBaseUrl}`;

    let issuerUrl = window.location.href;
    if (this.useLocalStorage && window.localStorage.getItem('casper_original_issuer')) {
      issuerUrl = window.localStorage.getItem('casper_original_issuer');
    }
    const urlHref = new URL(issuerUrl);
    const socketUrl = `${urlHref.protocol === 'https:' ? 'wss:' : 'ws:'}//${urlHref.hostname}${urlHref.port ? ':' + urlHref.port : ''}/epaper`;
    const socket2Url = `${urlHref.protocol === 'https:' ? 'wss:' : 'ws:'}//${urlHref.hostname}${urlHref.port ? ':' + urlHref.port : ''}/epaper2`;

    try {
      this.session = await this.socket.connectAndSetSession(socketUrl, this.socket.sessionCookie);
      this.socket._url = `${urlHref.protocol === 'https:' ? 'wss:' : 'ws:'}//${urlHref.hostname}`; // Manually set socket url

      if (!this.session.success) throw 'Invalid session';

      await this.socket2.connectAndSetSession(socket2Url, this.socket.sessionCookie);
      this.socket2._url = `${urlHref.protocol === 'https:' ? 'wss:' : 'ws:'}//${urlHref.hostname}`; // Manually set socket url
    } catch (error) {
      await this.logout();
      return;
    }
    try {
      this._state = 'connected';
      this._message = 'Ligação ao servidor estabelecida';

      if (this.session.role_mask > 0) {
        const menuData = await fetch(this.menuRoute, {
          headers: {
            Authorization: 'Bearer ' + this.socket.sessionCookie,
            'Content-Type': 'application/vnd.api+json'
          }
        });
        this._baseMenu = await menuData.json();
      } else {
        this._baseMenu = [];
      }

      this._createUrlMap(this._baseMenu);
      this._createCasperElements();
      this._createEventListeners();
      
      this._message = 'Menus e componentes carregados';

      this._state = 'ready';
    } catch (error) {
      this._state = 'error';
      this._message = 'Ocorreu um erro! ' + error;
    }
  }

  //**************************************************************************************************//
  //                                 ~~~ Application Routing ~~~                                      //
  //**************************************************************************************************//

  _buildLocationUrl (locationPath, locationQuery) {
    locationPath = locationPath.startsWith('/') ? locationPath : `/${locationPath}`;

    return !locationQuery ? locationPath : `${locationPath}?${locationQuery}`;
  }

  _searchOnRouter (route) {
    let existingRoute = this._urlMap.get(route);

    if (existingRoute) return existingRoute;

    for (let routeCharacterIndex = route.length; routeCharacterIndex >= 0; routeCharacterIndex--) {
      if (!['?', '/', '&'].includes(route[routeCharacterIndex])) continue;
      let existingRoute = this._urlMap.get(route.substring(0, routeCharacterIndex));

      if (existingRoute) return existingRoute;
    }
  }

  async _urlChanged () {

    const currentUrl = new URL(`${window.location.origin}${this._url}`);
    this.location.url = this._url;
    this.location.pathname = currentUrl.pathname;
    this.location.search = window.decodeURIComponent(currentUrl.search);
    this.location.hash = window.decodeURIComponent(currentUrl.hash);

    // Don't push the first url or when navigation back / forward to avoid a duplicate entry in the history.
    if (this._doNotPushEntry) {
      this._doNotPushEntry = false;
    } else {
      window.history.pushState({}, '', this._url);
    }

    // CasperOverlay.closeAllActiveOverlays();
    if (this.tooltip) {
      this.tooltip.hide();
    }
    // if (this._wizards) {
    //   this._removeAllWizards();
    // }

    // ... update the module information ...
    if (this.session?.module_mask) {
      // this._validateModule(route.replace('/toc', ''), this.session.module_mask);
    }

    await this.applicationLoaded;
    
    this._message = 'A carregar página';
    this._state = 'in-progress';
    
    let pageName;
    const pageElement = this._searchOnRouter(this._buildLocationUrl(this._url.split(this.baseUrl)[1])); // TODO: Fix this
    if ( pageElement && pageElement.props && pageElement.props.component ) {
      pageName = pageElement.props.component;
    } else if (!this.page) {
      this.showPage404();
      this._state = 'ready';
      return;
    } else {
      this._state = 'ready';
      return;
    }

    this._addElementToCasperPages(pageElement);

    if (pageName !== this.page) {
      let pageFilePath;
      if ( pageElement && pageElement.props && pageElement.props.component_source ) {
        pageFilePath = pageElement.props.component_source;
      } else {
        // Add 'toc-' for backwards compatibility
        pageFilePath = '/src/' + (this.digest ? `${this.digest}.` : '') + `toc-${pageName}.js`;
      }
      try {
        await import(pageFilePath);
        this.page = pageName;
      } catch (error) {
        this.showPage404(error);
      }
    } else {
      let page = this.pages?.selectedItem;
      if (page !== undefined && typeof page.updateQuery === 'function') {
        page.updateQuery(this._url, window.location.search.substring(1));
      }
    }

    this._state = 'ready';
  }

  //***************************************************************************************//
  //                              ~~~ Protected methods ~~~                                //
  //***************************************************************************************//

  _createCasperElements () {
    this.toast = document.createElement('casper-toast');
    this.tooltip = document.createElement('casper-tooltip');
    this.printDialog = document.createElement('casper-print-dialog');
    this.printDialog.socket = this.socket;

    document.body.appendChild(this.toast);
    document.body.appendChild(this.tooltip);
    document.body.appendChild(this.printDialog);

    this.tooltip.fitInto = document.body;
  }

  _createEventListeners () {
    window.addEventListener('popstate', event => {
      this._updateLocation(event.target.location);
    });

    this.socket.addEventListener('casper-disconnected', (e) => {
      this._state   = 'pending';
    });
    this.socket.addEventListener('casper-signed-in', (e) => {
      this._state   = 'ready';
      this._message = 'Sessão disponível';
    });
    this.socket.addEventListener('casper-signed-out', (e) => {
      this._state   = 'disconnected';
      this._message = 'Sessão terminada';
      window.location = this.loginLocation;
    });
    this.socket.addEventListener('casper-show-overlay', (e) => {
      if (e?.detail?.icon === 'error') {
        this._state = 'error';
      } else if (e?.detail?.icon === 'cloud') {
        this._state = 'pending';
      } else if (e?.detail?.spinner) {
        this._state = 'connecting';
      } else {
        this._state = 'unknown';
      }
      this._message = event?.detail?.message;
    }); 
    this.socket.addEventListener('casper-dismiss-overlay', (e) => {
      this._state   = 'ready';
      this._message = '';
    });

    this.addEventListener(CasperBrowser.isIos ? 'tap' : 'click', e => this._globalClickHandler(e));
    this.addEventListener('mousemove', this._mouseMoveHandler);
  }  

  _updateLocation (location) {
    this._doNotPushEntry = true;
    const { pathname, search, hash } = location;
    this._url = `${pathname}${search}${hash}`;
    this.location = {url: this._url, pathname: pathname, search: search, hash: hash};
  }

  _addElementToCasperPages (pageElement) {
    if (!this.pages) return;

    // Add 'toc-' for backwards compatibility
    const elementName = pageElement.props.component_source ? pageElement.props.component : 'toc-' + pageElement.props.component;
    const newPage = this.pages.querySelector(elementName);

    if (!newPage) {
      const newElement = document.createElement(elementName);
      newElement.setAttribute('name', pageElement.props.component);
      newElement.setAttribute('appended', Date.now());
      this.pages.appendChild(newElement);
    } else if (this.page === pageElement.props.component) {
      if (typeof newPage.attached === 'function') newPage.attached();
    }
  }

  _globalClickHandler (event) {
    this.socket.userActivity(event);

    let selectedElement = undefined;
    for (let element of event.composedPath()) {
      try {
        if (element.hasAttribute('no-follow')) {
          break;
        }
        if (element.hasAttribute('href') === true) {
          selectedElement = element;
        }
      } catch (e) {}
    }

    if (selectedElement) {
      const link = `${this.baseUrl === '/' ? '' : this.baseUrl}${selectedElement.getAttribute("href")}`;

      if (!selectedElement.hasAttribute('target')) {
        // Check if the user has the Cmd or Ctrl pressed.
        if (event.metaKey || event.ctrlKey) {
          window.open(link, '_blank');
        } else {
          this.changeRoute(link);
        }

        event.preventDefault();
        event.stopPropagation();
      }
    }
  }

  _mouseMoveHandler (event) {
    this.tooltip.mouseMoveToolip(event);
    if (!this.socket.sessionCookie || this.socket.sessionCookie === 'undefined') {
      this.logout();
      return;
    }
    if (this._state === 'disconnected' || this._state === 'pending' || !this.session) {
      this._reconnectSocket();
    }
  }

  async _reconnectSocket () {
    const debounceTimerExpired = (event) => {
      this._debounceTimeout = Math.min(this._debounceTimeout * 2, 10);
      this._debounceTimerId = undefined;
    }

    if ((this._state === 'disconnected' || this._state === 'pending' || !this.session) && this._debounceTimerId === undefined) {
      this._debounceTimerId = setTimeout(e => debounceTimerExpired(e), this._debounceTimeout * 1000);
      this._state = 'connecting';
      this._message = 'A restabelecer ligação ao servidor';
      this.socket.checkIfSessionChanged();
      this.socket.validateSession();
    }
  }

  _createUrlMap (items) {
    this._urlMap.clear();
    const urlMapSubFunc = (menuItems) => {
      for (let item of menuItems) {
        if (item.items) {
          urlMapSubFunc(item.items);
        }
  
        // not included the primary links (menu-level1) to not override the correct route
        if (!item.primary) {
          this._urlMap.set(item.link, { props: item.props, levels: item.level.split(',') });
        }
        // if (this._shouldRemoveSubItem(item)) {
        //   this._urlMap.delete(item.link);
        // }
      }
    }
    urlMapSubFunc(items);
  }

  //***************************************************************************************//
  //                                ~~~ Public methods ~~~                                 //
  //***************************************************************************************//

  showPage404 (error) {
    console.error(error);
    this.page = 'notfound404';
  }

  openToast ({text, duration = 8000, backgroundColor = ''}) {
    this.toast.text = text;
    this.toast.duration = duration;
    this.toast.backgroundColor = backgroundColor;
    this.toast.open();
  }

  showPrintDialog (options) {
    this.printDialog.setOptions(options);
    this.printDialog.open();
  }

  changeRoute (route) {
    let [locationPath, locationQuery] = route.split('?');

    if (this.location.pathname === locationPath) {
      // Even though the path did not change, the query might've.
      let clearQuery = false;
      const currentPage = this.pages?.selectedItem;

      // Check if the current page has a handler for when the location query changes.
      if (currentPage && typeof currentPage.updateQuery === 'function') {
        clearQuery = currentPage.updateQuery(locationPath, locationQuery);
      }

      if (clearQuery) locationQuery = '';
    }

    this._url = this._buildLocationUrl(locationPath, locationQuery);
  }

  async logout () {
    try {
      if (this.socket.sessionCookie) {
        const request = await fetch('/login/sign-out', {
          headers: {
            'x-casper-access-token': this.socket.sessionCookie,
            'Content-Type': 'application/json'
          }
        });
      }
    } catch (exception) {
      // ... ignore and proceed with the the logout
    } finally {
      this.socket.disconnect();
      this.socket.wipeCredentials();
      window.location = this.loginLocation;
    }
  }
}