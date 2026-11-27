import { discoverService } from '@/services/discover';
import { type PluginQueryParams } from '@/types/discover';
import { convertOpenAIManifestToLobeManifest, getToolManifest } from '@/utils/toolManifest';

class ToolService {
  getOldPluginList = async (params: PluginQueryParams): Promise<any> => {
    const page = params.page ? Number(params.page) : 1;
    const pageSize = params.pageSize ? Number(params.pageSize) : 20;

    return discoverService.getMcpList({
      category: params.category,
      q: params.search,
      page,
      pageSize,
    });
  };

  getToolManifest = getToolManifest;
  convertOpenAIManifestToLobeManifest = convertOpenAIManifestToLobeManifest;
}

export const toolService = new ToolService();
