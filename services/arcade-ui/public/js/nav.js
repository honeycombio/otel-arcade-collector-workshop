// Injects the persistent sidebar navigation into every arcade-ui page.
// Add one script tag to each page: <script src="/js/nav.js"></script>
(function () {
  var GAME_PATHS = ['/', '/index.html',
    '/memory.html', '/typing.html', '/whackamole.html',
    '/reaction.html', '/target-shooter.html', '/word-scramble.html',
    '/math-sprint.html', '/simon-says.html', '/speed-tap.html',
    '/wave-defender.html', '/bid-wars.html', '/hot-cache.html',
    '/pixel-sort.html', '/chain-reaction.html', '/deadline-dash.html'];

  var AVATARS = {
    robot: '🤖', alien: '👾', fox: '🦊', dragon: '🐉',
    unicorn: '🦄', ghost: '👻', ninja: '🥷', wizard: '🧙',
    rocket: '🚀', cat: '🐱', octopus: '🐙', gamepad: '🎮',
  };

  // Read avatar from localStorage at inject-time so the icon renders synchronously
  var savedKey    = localStorage.getItem('arcade.player_avatar') || '';
  var profileIcon = (savedKey && AVATARS[savedKey]) ? AVATARS[savedKey] : '👤';

  var NAV_ITEMS = [
    { type: 'section', label: 'Arcade' },
    { label: 'Profile', href: '/profile.html', icon: profileIcon, activeOn: ['/profile.html'] },
    { label: 'Games',            href: '/',                   icon: '🎮', activeOn: GAME_PATHS },
    { label: 'Leaderboard',      href: '/leaderboard.html',   icon: '🏆', activeOn: ['/leaderboard.html'] },
    { type: 'section', label: 'Collector' },
    { label: 'Visualizer',       href: '/visualizer.html',    icon: '◈',  activeOn: ['/visualizer.html'] },
    { label: 'Deploy & Configure', href: '/collector.html',   icon: '⚙',  activeOn: ['/collector.html', '/deploy.html'] },
    { label: 'TelemetryGen',     href: '/telemetrygen.html',  icon: '⚡', activeOn: ['/telemetrygen.html'] },
  ];

  var path = location.pathname;

  var items = NAV_ITEMS.map(function (item) {
    if (item.type === 'section') {
      return '<div class="sidebar-section">' + item.label + '</div>';
    }
    var active = item.activeOn
      ? item.activeOn.indexOf(path) !== -1 || path === ''
      : false;
    var cls = 'sidebar-item' + (active ? ' active' : '');
    return '<a href="' + item.href + '" class="' + cls + '">'
      + '<span class="sidebar-icon">' + item.icon + '</span>'
      + item.label
      + '</a>';
  }).join('');

  var sidebar = '<nav class="sidebar" aria-label="OTel Arcade navigation">'
    + '<a class="sidebar-brand" href="/">OTel<br>Arcade</a>'
    + '<div class="sidebar-nav">' + items + '</div>'
    + '</nav>';

  document.body.insertAdjacentHTML('afterbegin', sidebar);
})();
