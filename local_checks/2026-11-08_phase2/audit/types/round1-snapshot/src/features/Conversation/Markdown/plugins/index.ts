import ImageSearchRef from './ImageSearchRef';
import InteractiveForm from './InteractiveForm';
import InteractiveWidget from './InteractiveWidget';
import LobeArtifact from './LobeArtifact';
import LobeOptions from './LobeOptions';
import LobeThinking from './LobeThinking';
import LocalFile from './LocalFile';
import Mention from './Mention';
import Skill from './Skill';
import Task from './Task';
import Thinking from './Thinking';
import Tool from './Tool';
import { type MarkdownElement } from './type';
import UserFeedback from './UserFeedback';

export type { MarkdownElement } from './type';

export const markdownElements: MarkdownElement[] = [
  Thinking,
  LobeArtifact,
  InteractiveWidget,
  // Legacy tags kept for backward-compat rendering of historical messages;
  // new content should be emitted via InteractiveWidget's unified `kind` envelope.
  LobeOptions,
  InteractiveForm,
  LobeThinking,
  LocalFile,
  Mention,
  Skill,
  Tool,
  Task,
  UserFeedback,
  ImageSearchRef,
];
