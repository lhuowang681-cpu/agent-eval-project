import type { ModelProviderCard } from '@/types/llm';

const ADA_LOGO = 'https://dimg04.c-ctrip.com/images/1xt4u12000s5gb39t227A.png';

const AdaProvider: ModelProviderCard = {
  chatModels: [],
  checkModel: 'claude-sonnet-4-6',
  description:
    'Coding Plan provides a unified gateway for curated chat models via Anthropic API. Configure your API base URL and API key.',
  enabled: true,
  id: 'ada',
  logo: ADA_LOGO,
  modelList: { showModelFetcher: false },
  name: 'Ada',
  settings: {
    defaultShowBrowserRequest: false,
    disableBrowserRequest: true,
    modelEditable: false,
    sdkType: 'openai',
    showAddNewModel: false,
    showApiKey: false,
    showChecker: true,
    showModelFetcher: false,
    modelListHeaderText: '启用模型前，请确认 Ada 平台已配置该模型',
  },
  url: '',
};

export default AdaProvider;
