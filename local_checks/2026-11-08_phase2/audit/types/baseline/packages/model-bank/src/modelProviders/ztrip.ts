import type { ModelProviderCard } from '@/types/llm';

const Ztrip: ModelProviderCard = {
  chatModels: [],
  checkModel: 'claude-sonnet-4-6',
  description: '仅供公司内部部分人员使用',
  enabled: true,
  id: 'ztrip',
  modelList: { showModelFetcher: false },
  name: 'VIP-Only',
  logo: 'https://m.suanya.com/favicon.ico',
  url: '',
  settings: {
    defaultShowBrowserRequest: false,
    disableBrowserRequest: true,
    modelEditable: false,
    sdkType: 'openai',
    showApiKey: false,
    showModelFetcher: false,
    showAddNewModel: false,
    showChecker: true,
  },
};

export default Ztrip;
