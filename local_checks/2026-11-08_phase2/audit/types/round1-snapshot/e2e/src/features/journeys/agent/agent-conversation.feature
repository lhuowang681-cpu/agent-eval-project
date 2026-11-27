@journey @agent @conversation
Feature: Agent 对话用户体验链路
  作为用户，我希望能够与 AI 助手进行流畅的对话

  Background:
    Given 用户已登录系统

  @AGENT-CHAT-001 @P0 @smoke
  Scenario: 使用 TripYoYo AI 发送消息并获得回复
    Given 用户进入 TripYoYo AI 对话页面
    When 用户发送消息 "hello"
    Then 用户应该收到助手的回复
    And 回复内容应该可见

  @AGENT-CHAT-002 @P1 @summary
  Scenario: 首轮对话后自动总结生成话题标题
    Given 用户进入 TripYoYo AI 对话页面
    And 话题标题总结将返回 "账户问题咨询"
    When 用户在新话题中发送消息 "我的账户登录不上了，一直提示密码错误"
    Then 用户应该收到助手的回复
    And 当前话题标题应自动更新为 "账户问题咨询"
