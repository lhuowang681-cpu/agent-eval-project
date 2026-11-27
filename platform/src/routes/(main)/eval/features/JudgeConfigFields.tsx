import { Form, Input, InputNumber } from 'antd';
import { useTranslation } from 'react-i18next';

export default function JudgeConfigFields() {
  const { t } = useTranslation('eval');
  return (
    <>
      <Form.Item
        label={t('judge.provider')}
        name={['evalConfig', 'provider']}
        rules={[{ required: true, whitespace: true }]}
      >
        <Input />
      </Form.Item>
      <Form.Item
        label={t('judge.model')}
        name={['evalConfig', 'model']}
        rules={[{ required: true, whitespace: true }]}
      >
        <Input />
      </Form.Item>
      <Form.Item label={t('judge.criteria')} name={['evalConfig', 'criteria']}>
        <Input.TextArea rows={3} />
      </Form.Item>
      <Form.Item label={t('judge.systemRole')} name={['evalConfig', 'systemRole']}>
        <Input.TextArea rows={2} />
      </Form.Item>
      <Form.Item label={t('judge.timeoutMs')} name={['evalConfig', 'timeoutMs']}>
        <InputNumber min={100} max={60_000} precision={0} />
      </Form.Item>
      <Form.Item
        extra={t('judge.completeOverride')}
        label={t('judge.legacyPrompt')}
        name={['evalConfig', 'judgePrompt']}
      >
        <Input.TextArea rows={2} />
      </Form.Item>
    </>
  );
}
