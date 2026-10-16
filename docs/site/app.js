const repository = 'https://github.com/yucheng-du/MES';
const translations = {
  'zh-CN': {
    skip: '跳到主要内容', 'nav.label': '主导航', 'nav.demo': '演示', 'nav.features': '功能', 'nav.docs': '文档',
    eyebrow: '开源 · 制造执行系统', 'heading.first': '从订单到交付，', 'heading.second': '看清生产每一步。',
    intro: '面向小工厂的开源 MES。把订单、车间作业、质量、库存与工资，放到同一个工作空间。',
    start: '开始使用', watch: '观看演示', source: '浏览源码',
    'preview.title': '产品演示', 'preview.label': 'MES 产品演示',
    'preview.fallback': '下载演示视频',
    'features.tag': '围绕工厂日常', 'features.title': '让每项工作，都有着落。', 'features.link': '查看完整功能',
    'production.title': '生产执行', 'production.body': '从产品工艺、订单与工单，到任务分派和车间报工。',
    'quality.title': '质量与审核', 'quality.body': '检验、报废处理与报工审核，保留每一步的记录。',
    'inventory.title': '库存与采购', 'inventory.body': '成品和物料出入库、采购申请，以及分次付款。',
    'equipment.title': '设备与现场', 'equipment.body': '设备运行统计、点检保养与安灯，让现场问题有迹可循。',
    'people.title': '人员与工资', 'people.body': '人员档案、分级权限、工作任务，以及计件与计时工资。',
    'mobile.title': 'Android 移动端', 'mobile.body': '在现场扫码、查看图纸、上传文件，并接入可选标签打印。',
    'start.tag': '从这里开始', 'start.first': '在你的环境，', 'start.second': '运行你的 MES。',
    'start.body': '先运行本地演示，再按部署文档配置自己的服务。源码和文档都在 GitHub。',
    'guide.title': '本地快速启动', 'guide.body': '安装依赖，启动服务，试用演示数据。',
    'deploy.title': '部署与备份', 'deploy.body': '配置、上线与日常维护的完整说明。',
    'android.title': 'Android 使用指南', 'android.body': '构建客户端，连接自己的 MES 服务。',
    'footer.label': '项目链接', 'footer.contribute': '参与贡献', 'footer.security': '安全反馈', 'footer.credits': '媒体来源',
  },
  'en-US': {
    skip: 'Skip to content', 'nav.label': 'Main navigation', 'nav.demo': 'Demo', 'nav.features': 'Features', 'nav.docs': 'Docs',
    eyebrow: 'OPEN SOURCE · MANUFACTURING EXECUTION SYSTEM', 'heading.first': 'Keep production', 'heading.second': 'in view.',
    intro: 'An open-source MES for small factories. Connect orders, shop floor work, quality, inventory and pay in one workspace.',
    start: 'Get started', watch: 'Watch the demo', source: 'Explore the source',
    'preview.title': 'Product demo', 'preview.label': 'MES product demo',
    'preview.fallback': 'Download the demo video',
    'features.tag': 'EVERYDAY FACTORY WORK', 'features.title': 'Keep the work connected.', 'features.link': 'Explore all features',
    'production.title': 'Production', 'production.body': 'Product routes, orders and work orders, task assignments and shop floor reporting.',
    'quality.title': 'Quality & review', 'quality.body': 'Inspections, scrap handling and report review, with a record of each step.',
    'inventory.title': 'Stock & purchasing', 'inventory.body': 'Finished goods and materials, purchase requests and partial payments.',
    'equipment.title': 'Equipment', 'equipment.body': 'Operating statistics, maintenance checks and Andon to follow issues on the floor.',
    'people.title': 'People & pay', 'people.body': 'Personnel records, access controls, work tasks, piecework and hourly pay.',
    'mobile.title': 'Android companion', 'mobile.body': 'Scan codes, view drawings, upload files and connect optional label printing.',
    'start.tag': 'MAKE IT YOURS', 'start.first': 'Your environment.', 'start.second': 'Your MES.',
    'start.body': 'Start with the local demo, then follow the deployment guide for your own setup. Source and documentation are on GitHub.',
    'guide.title': 'Local quick start', 'guide.body': 'Install, run and explore with demo data.',
    'deploy.title': 'Deployment & backups', 'deploy.body': 'Configuration, deployment and ongoing maintenance.',
    'android.title': 'Android guide', 'android.body': 'Build the companion and connect your MES instance.',
    'footer.label': 'Project links', 'footer.contribute': 'Contribute', 'footer.security': 'Security', 'footer.credits': 'Media credits',
  },
};

let locale = 'zh-CN';
try {
  if (localStorage.getItem('mes.docs.locale') === 'en-US') locale = 'en-US';
} catch {}

function render() {
  const copy = translations[locale];
  const english = locale === 'en-US';
  document.documentElement.lang = locale;
  document.title = english ? 'MES · Manufacturing Execution System' : 'MES · 制造执行系统';
  document.querySelector('meta[name="description"]').content = copy.intro;
  for (const element of document.querySelectorAll('[data-i18n]')) {
    element.textContent = copy[element.dataset.i18n];
  }
  for (const element of document.querySelectorAll('[data-i18n-aria]')) {
    element.setAttribute('aria-label', copy[element.dataset.i18nAria]);
  }
  const toggle = document.querySelector('#language');
  toggle.textContent = english ? '中文' : 'English';
  toggle.setAttribute('aria-label', english ? '切换为中文' : 'Switch to English');
  const suffix = english ? '.md' : '.zh-CN.md';
  document.querySelector('#guide').href = repository + (english ? '#quick-start' : '#快速启动');
  document.querySelector('#features-guide').href = repository + '/blob/main/docs/FEATURES' + suffix;
  document.querySelector('#deployment-guide').href = repository + '/blob/main/docs/DEPLOYMENT' + suffix;
  document.querySelector('#android-guide').href = repository + '/blob/main/apps/android/README' + suffix;
}

const languageButton = document.querySelector('#language');
languageButton.addEventListener('click', () => {
  locale = locale === 'zh-CN' ? 'en-US' : 'zh-CN';
  try { localStorage.setItem('mes.docs.locale', locale); } catch {}
  render();
});
render();
languageButton.hidden = false;
