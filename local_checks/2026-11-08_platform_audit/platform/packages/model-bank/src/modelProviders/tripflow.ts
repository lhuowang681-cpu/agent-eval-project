import type { ModelProviderCard } from '@/types/llm';

const TRIPFLOW_LOGO = 'http://trn-video-editor-web-function.faas.ctripcorp.com/static/favicon.ico';

const TripFlowProvider: ModelProviderCard = {
  chatModels: [],
  checkModel: 'claude-sonnet-4-6',
  description:
    'TripYoYo provides a unified gateway for curated chat, image, and video models. Configure your Peta Key ID; server-side credentials are resolved through the Peta SDK.',
  enabled: true,
  id: 'tripflow',
  logo: TRIPFLOW_LOGO,
  modelList: { showModelFetcher: false },
  name: 'Peta',
  settings: {
    defaultShowBrowserRequest: false,
    disableBrowserRequest: true,
    modelEditable: false,
    sdkType: 'openai',
    showAddNewModel: false,
    showApiKey: false,
    showChecker: true,
    showModelFetcher: false,
    modelListHeaderText: '(启用模型前，请确认 Peta 应用已申请该模型)',
  },
  url: '',
};

export default TripFlowProvider;
