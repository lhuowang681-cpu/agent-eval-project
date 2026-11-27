interface GetProviderDescriptionParams {
  description?: string;
  id: string;
  isCustom: boolean;
  t: (key: string) => string;
}

export const getProviderDescriptionKey = (id: string) => `${id}.description`;

export const getProviderDescription = ({
  description,
  id,
  isCustom,
  t,
}: GetProviderDescriptionParams) => {
  if (isCustom) return description;

  const key = getProviderDescriptionKey(id);
  const translated = t(key);

  return translated && translated !== key ? translated : description;
};
