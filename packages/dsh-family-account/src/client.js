'use strict';

const React = require('react');
const ReactDOM = require('react-dom');
const h = React.createElement;
const CHANNEL = 'homelab-dsh-family';
const VERSION = 1;
const listeners = new Set();
let portalState = { account: null, approvalState: { status: 'loading' }, approvalBusyId: '', approvalNotice: '', logoutPending: false, logoutNotice: '' };

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isApprovalRequest(value) {
  if (!isRecord(value) || typeof value.id !== 'string'
    || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(value.id)) return false;
  if (value.operation === 'search') {
    return typeof value.query === 'string' && value.query.length > 0 && value.query.length <= 1000
      && Number.isSafeInteger(value.maxResults) && value.maxResults >= 1 && value.maxResults <= 10;
  }
  return value.operation === 'fetch' && typeof value.url === 'string' && value.url.length > 0 && value.url.length <= 4096;
}

function isApprovalState(value) {
  if (!isRecord(value) || !['ready', 'disabled', 'unavailable', 'signed-out', 'unassigned'].includes(value.status)) return false;
  return value.status !== 'ready'
    || (Array.isArray(value.requests) && value.requests.length <= 20 && value.requests.every(isApprovalRequest));
}

function isPortalState(value) {
  return isRecord(value) && isRecord(value.account)
    && typeof value.account.name === 'string' && value.account.name.length <= 160
    && typeof value.account.username === 'string' && value.account.username.length <= 32
    && typeof value.account.isAdmin === 'boolean'
    && Array.isArray(value.account.plugins) && value.account.plugins.length <= 20
    && value.account.plugins.every(plugin => typeof plugin === 'string' && plugin.length <= 80)
    && isApprovalState(value.approvalState)
    && typeof value.approvalBusyId === 'string' && value.approvalBusyId.length <= 64
    && typeof value.approvalNotice === 'string' && value.approvalNotice.length <= 200
    && typeof value.logoutPending === 'boolean'
    && typeof value.logoutNotice === 'string' && value.logoutNotice.length <= 200;
}

function publish(next) {
  portalState = next;
  for (const listener of listeners) listener();
}

function usePortalState() {
  const [snapshot, setSnapshot] = React.useState(portalState);
  React.useEffect(() => {
    const listener = () => setSnapshot(portalState);
    listeners.add(listener);
    listener();
    return () => { listeners.delete(listener); };
  }, []);
  return snapshot;
}

function sendToPortal(type, fields = {}) {
  if (window.parent === window) return;
  window.parent.postMessage({ channel: CHANNEL, version: VERSION, type, ...fields }, window.location.origin);
}

function updatePosition(anchor, setPosition) {
  const rect = anchor.getBoundingClientRect();
  const width = 320;
  setPosition({
    left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
    bottom: Math.max(8, window.innerHeight - rect.top + 8),
  });
}

function useDismiss(open, setOpen, anchorRef, panelRef) {
  React.useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = event => {
      if (anchorRef.current?.contains(event.target) || panelRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    const onKeyDown = event => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      anchorRef.current?.focus();
    };
    const onResize = () => setOpen(false);
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onResize);
    };
  }, [open, setOpen, anchorRef, panelRef]);
}

function AccountAction({ wide }) {
  const state = usePortalState();
  const account = state.account;
  const [open, setOpen] = React.useState(false);
  const [position, setPosition] = React.useState({ left: 8, bottom: 72 });
  const anchorRef = React.useRef(null);
  const panelRef = React.useRef(null);
  useDismiss(open, setOpen, anchorRef, panelRef);
  if (account === null) return null;

  const toggle = () => {
    if (!open && anchorRef.current) updatePosition(anchorRef.current, setPosition);
    setOpen(current => !current);
  };
  const initials = [...account.name.trim()][0] || 'D';
  const button = h('button', {
    ref: anchorRef,
    type: 'button',
    className: `dsh-family-account__trigger${wide ? '' : ' dsh-family-account__trigger--rail'}`,
    'aria-label': `${account.name}, @${account.username}, 활성 플러그인 ${account.plugins.length}개`,
    'aria-haspopup': 'dialog',
    'aria-expanded': open,
    onClick: toggle,
  }, [
    h('span', { className: 'dsh-family-account__avatar', 'aria-hidden': 'true', key: 'avatar' }, initials),
    wide ? h('span', { className: 'dsh-family-account__identity', key: 'identity' }, [
      h('strong', { key: 'name' }, account.name),
      h('small', { key: 'username' }, `@${account.username}`),
    ]) : null,
    wide ? h('span', { className: 'dsh-family-account__count', key: 'count' }, `플러그인 ${account.plugins.length}`) : null,
  ]);

  const panel = open ? ReactDOM.createPortal(h('section', {
    ref: panelRef,
    className: 'dsh-family-account__panel',
    role: 'dialog',
    'aria-label': '내 작업공간 계정',
    style: position,
  }, [
    h('header', { className: 'dsh-family-account__panel-head', key: 'head' }, [
      h('div', { className: 'dsh-family-account__panel-title', key: 'title' }, [
        h('span', { className: 'dsh-family-account__avatar', 'aria-hidden': 'true', key: 'avatar' }, initials),
        h('span', { key: 'labels' }, [
          h('strong', { key: 'name' }, account.name),
          h('small', { key: 'username' }, `@${account.username}`),
        ]),
      ]),
      h('button', { type: 'button', className: 'dsh-family-account__close', 'aria-label': '닫기', onClick: () => setOpen(false), key: 'close' }, '×'),
    ]),
    h('section', { className: 'dsh-family-account__features', 'aria-label': '활성 플러그인', key: 'features' }, [
      h('h3', { key: 'heading' }, `사용 기능 · ${account.plugins.length}`),
      account.plugins.length === 0
        ? h('p', { className: 'dsh-family-account__empty', key: 'empty' }, '활성 플러그인이 없습니다.')
        : h('ul', { key: 'list' }, account.plugins.map((plugin, index) => h('li', { key: `${index}-${plugin}` }, plugin))),
    ]),
    h('a', {
      className: 'dsh-family-account__action',
      href: '/family/search-approval',
      target: '_top',
      key: 'search-settings',
    }, '검색 승인 설정'),
    account.isAdmin ? h('button', {
      className: 'dsh-family-account__action',
      type: 'button',
      onClick: () => { setOpen(false); sendToPortal('open-admin'); },
      key: 'admin',
    }, '관리자 설정') : null,
    h('p', { className: 'dsh-family-account__notice', role: 'status', key: 'notice' }, state.logoutNotice),
    h('button', {
      className: 'dsh-family-account__action dsh-family-account__action--danger',
      type: 'button',
      disabled: state.logoutPending,
      onClick: () => sendToPortal('logout'),
      key: 'logout',
    }, state.logoutPending ? '로그아웃 중…' : '로그아웃'),
  ]), document.body) : null;

  return h(React.Fragment, null, [button, panel]);
}

function SearchApprovalDock() {
  const state = usePortalState();
  const [open, setOpen] = React.useState(false);
  const [position, setPosition] = React.useState({ left: 8, bottom: 72 });
  const anchorRef = React.useRef(null);
  const panelRef = React.useRef(null);
  const seenRequests = React.useRef(new Set());
  const approval = state.approvalState;
  const requests = approval.status === 'ready' ? approval.requests : [];
  const pendingCount = requests.length;
  const unavailable = approval.status === 'unavailable';
  useDismiss(open, setOpen, anchorRef, panelRef);

  React.useEffect(() => {
    const newRequests = requests.filter(request => !seenRequests.current.has(request.id));
    for (const request of requests) seenRequests.current.add(request.id);
    if (newRequests.length > 0) {
      if (anchorRef.current) updatePosition(anchorRef.current, setPosition);
      setOpen(true);
    }
  }, [requests]);

  if (pendingCount === 0 && !unavailable) return null;
  const toggle = () => {
    if (!open && anchorRef.current) updatePosition(anchorRef.current, setPosition);
    setOpen(current => !current);
  };
  const label = unavailable ? '검색 승인 연결 확인' : `검색 승인 필요 · ${pendingCount}`;
  const panel = open ? ReactDOM.createPortal(h('section', {
    ref: panelRef,
    className: 'dsh-family-search__panel',
    role: 'dialog',
    'aria-label': '검색 승인 요청',
    style: position,
  }, [
    h('header', { className: 'dsh-family-search__head', key: 'head' }, [
      h('strong', { key: 'title' }, '검색 승인'),
      h('button', { type: 'button', 'aria-label': '닫기', onClick: () => setOpen(false), key: 'close' }, '×'),
    ]),
    h('p', { className: 'dsh-family-search__intro', key: 'intro' }, '검색어는 로컬 검색 엔진으로, URL은 수집기로 전달합니다. 검색 엔진은 설정된 공개 검색 서비스에 질의할 수 있습니다. 대화와 파일은 보내지 않습니다.'),
    state.approvalNotice ? h('p', { className: 'dsh-family-search__notice', role: 'status', key: 'notice' }, state.approvalNotice) : null,
    unavailable
      ? h('p', { className: 'dsh-family-search__empty', key: 'unavailable' }, '검색 승인 서비스에 연결할 수 없습니다. 페이지를 새로고침해 주세요.')
      : requests.length === 0
        ? h('p', { className: 'dsh-family-search__empty', key: 'empty' }, '대기 중인 검색 요청이 없습니다.')
        : h('ul', { className: 'dsh-family-search__list', key: 'requests' }, requests.map(request => h('li', { key: request.id }, [
          h('div', { className: 'dsh-family-search__request-title', key: 'title' }, [
            h('strong', { key: 'kind' }, request.operation === 'search' ? '검색어' : '가져올 URL'),
            request.operation === 'search' ? h('span', { key: 'count' }, `최대 ${request.maxResults}개 결과`) : null,
          ]),
          h('pre', { key: 'query' }, request.operation === 'search' ? request.query : request.url),
          h('div', { className: 'dsh-family-search__actions', key: 'actions' }, [
            h('button', {
              type: 'button',
              disabled: state.approvalBusyId !== '',
              onClick: () => sendToPortal('decide-search', { requestId: request.id, decision: 'allow' }),
              key: 'allow',
            }, state.approvalBusyId === request.id ? '처리 중…' : '허용'),
            h('button', {
              type: 'button',
              disabled: state.approvalBusyId !== '',
              onClick: () => sendToPortal('decide-search', { requestId: request.id, decision: 'deny' }),
              key: 'deny',
            }, '거부'),
          ]),
        ]))),
  ]), document.body) : null;

  return h(React.Fragment, null, [
    h('button', {
      ref: anchorRef,
      type: 'button',
      className: `dsh-family-search__trigger${unavailable ? ' dsh-family-search__trigger--error' : ''}`,
      'aria-label': label,
      'aria-haspopup': 'dialog',
      'aria-expanded': open,
      'aria-live': 'polite',
      onClick: toggle,
      key: 'trigger',
    }, [
      h('span', { 'aria-hidden': 'true', key: 'icon' }, '!'),
      h('span', { key: 'label' }, label),
    ]),
    panel,
  ]);
}

const styleText = `
.dsh-family-account__trigger{box-sizing:border-box;display:flex;align-items:center;gap:10px;width:100%;min-width:0;min-height:46px;padding:5px 10px;border:1px solid transparent;border-radius:10px;color:#e8eaf0;background:transparent;text-align:left;cursor:pointer}
.dsh-family-account__trigger[aria-expanded=true]{background:#292b30}
.dsh-family-account__trigger:focus-visible,.dsh-family-account__close:focus-visible,.dsh-family-account__action:focus-visible,.dsh-family-search__trigger:focus-visible,.dsh-family-search__head button:focus-visible,.dsh-family-search__actions button:focus-visible{outline:2px solid #91b4ff;outline-offset:2px}
@media(hover:hover){.dsh-family-account__trigger:hover{background:#292b30}.dsh-family-search__trigger:hover{border-color:#d49238;background:#49361e}}
.dsh-family-account__trigger--rail{width:42px;min-height:42px;justify-content:center;padding:3px}
.dsh-family-account__avatar{display:grid;width:32px;height:32px;flex:none;place-items:center;border-radius:9px;color:#fff;background:#416fe8;font-size:14px;font-weight:500;text-transform:uppercase}
.dsh-family-account__identity{display:grid;min-width:0;flex:1;gap:2px}
.dsh-family-account__identity strong,.dsh-family-account__panel-title strong{overflow:hidden;color:#f2f3f5;font-size:13px;font-weight:500;text-overflow:ellipsis;white-space:nowrap}
.dsh-family-account__identity small,.dsh-family-account__panel-title small{color:#aeb4bf;font-size:12px}
.dsh-family-account__count{flex:none;padding:4px 7px;border:1px solid #41444b;border-radius:999px;color:#c5cad3;font-size:10px;white-space:nowrap}
.dsh-family-account__panel,.dsh-family-search__panel{box-sizing:border-box;position:fixed;z-index:10000;width:min(320px,calc(100vw - 16px));max-height:min(64dvh,520px);padding:14px;overflow:auto;border:1px solid #45484e;border-radius:14px;color:#e6e8ec;background:#202125;box-shadow:0 14px 38px #0008;font:13px/1.45 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
.dsh-family-account__panel-head,.dsh-family-search__head{display:flex;align-items:center;justify-content:space-between;gap:12px}
.dsh-family-account__panel-title{display:flex;min-width:0;align-items:center;gap:10px}
.dsh-family-account__panel-title>span:last-child{display:grid;min-width:0;gap:3px}
.dsh-family-account__close,.dsh-family-search__head button{display:grid;width:36px;height:36px;flex:none;place-items:center;border:1px solid #45484e;border-radius:9px;color:#e6e8ec;background:#292b30;font-size:20px;cursor:pointer}
.dsh-family-account__features{margin-top:16px;padding-top:13px;border-top:1px solid #393c42}
.dsh-family-account__features h3{margin:0 0 9px;color:#b9bec7;font-size:12px;font-weight:500}
.dsh-family-account__features ul{display:flex;flex-wrap:wrap;gap:6px;margin:0;padding:0;list-style:none}
.dsh-family-account__features li{padding:6px 9px;border:1px solid #3d4047;border-radius:999px;color:#e2e4e8;background:#292b30;font-size:12px}
.dsh-family-account__empty,.dsh-family-search__empty{margin:8px 0 0;padding:11px;border-radius:9px;color:#c4c8d0;background:#292b30;line-height:1.5}
.dsh-family-account__action{display:flex;width:100%;min-height:42px;align-items:center;justify-content:center;margin-top:10px;padding:0 12px;border:1px solid #45484e;border-radius:9px;color:#e6e8ec;background:#292b30;font:500 13px system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;text-decoration:none;cursor:pointer}
.dsh-family-account__action--danger{border-color:#68434a;color:#ffdadf;background:#39272b}
.dsh-family-account__action:disabled,.dsh-family-search__actions button:disabled{cursor:wait;opacity:.6}
.dsh-family-account__notice,.dsh-family-search__notice{margin:8px 0 0;color:#ffb4ab;font-size:12px;line-height:1.5}
.dsh-family-search__trigger{box-sizing:border-box;display:inline-flex;min-height:30px;align-items:center;gap:7px;padding:4px 10px;border:1px solid #8c5b22;border-radius:999px;color:#ffe0b2;background:#382c1c;font:500 12px/1.3 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer}
.dsh-family-search__trigger[aria-expanded=true]{border-color:#d49238;background:#49361e}
.dsh-family-search__trigger--error{border-color:#8a4650;color:#ffd7dc;background:#3b252a}
.dsh-family-search__trigger span:first-child{display:grid;width:18px;height:18px;place-items:center;border-radius:50%;color:#241b10;background:#ffbf66;font-size:11px;font-weight:500}
.dsh-family-search__trigger--error span:first-child{color:#291417;background:#ff9aa5}
.dsh-family-search__intro{margin:10px 0 0;color:#c3c7ce;font-size:12px;line-height:1.5}
.dsh-family-search__list{display:grid;gap:10px;margin:10px 0 0;padding:0;list-style:none}
.dsh-family-search__list li{display:grid;gap:7px;padding:10px;border:1px solid #45484e;border-radius:10px}
.dsh-family-search__request-title{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
.dsh-family-search__request-title span{color:#aeb4bf;font-size:11px}
.dsh-family-search__list pre{max-height:110px;margin:0;padding:9px;overflow:auto;border-radius:8px;color:#f2f3f5;background:#17181b;font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;overflow-wrap:anywhere}
.dsh-family-search__actions{display:flex;justify-content:flex-end;gap:8px}
.dsh-family-search__actions button{min-width:76px;min-height:38px;padding:0 11px;border:1px solid #555961;border-radius:8px;color:#f2f3f5;background:#2b2d32;font:500 12px system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer}
.dsh-family-search__actions button:first-child{border-color:#416fe8;background:#315cc4}
@media(prefers-reduced-motion:no-preference){.dsh-family-search__trigger:not([aria-expanded=true]){animation:dsh-family-search-pulse 1.8s ease-in-out 2}@keyframes dsh-family-search-pulse{50%{box-shadow:0 0 0 4px #ffbf6633}}}
`;

function apply(ctx) {
  ctx.effect(() => {
    if (document.getElementById('dsh-family-account-styles')) return undefined;
    const style = document.createElement('style');
    style.id = 'dsh-family-account-styles';
    style.textContent = styleText;
    document.head.append(style);
    return () => style.remove();
  }, 'dsh-family-account: styles');

  ctx.effect(() => {
    const onMessage = event => {
      if (event.origin !== window.location.origin || event.source !== window.parent) return;
      const value = event.data;
      if (!isRecord(value) || value.channel !== CHANNEL || value.version !== VERSION || value.type !== 'portal-state') return;
      if (!isPortalState(value.state)) return;
      publish(value.state);
    };
    window.addEventListener('message', onMessage);
    sendToPortal('ready');
    return () => window.removeEventListener('message', onMessage);
  }, 'dsh-family-account: portal bridge');

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'family-account',
    order: 100,
    label: '내 작업공간',
  }, AccountAction));

  ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
    name: 'conversation.composer.dock',
    id: 'family-search-approval',
    order: 30,
    label: '검색 승인',
  }, SearchApprovalDock));
}

module.exports = { name: 'dsh-family-account', inject: ['slots'], apply };
