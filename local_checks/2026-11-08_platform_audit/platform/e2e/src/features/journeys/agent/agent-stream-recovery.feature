@journey @agent @stream-recovery
Feature: Agent 流式回复中断恢复
  作为用户，当模型 SSE 意外断开时，系统应自动续写一次；仍失败则提示手动继续

  Background:
    Given 用户已登录系统

  @AGENT-STREAM-001 @P0
  Scenario: SSE 中断后自动续写并完成回复
    Given 用户进入 TripYoYo AI 对话页面且已启用流恢复 Mock
    When 用户发送消息 "stream-cutoff"
    Then 助手最终应显示完整回复 "这是未完成的回复片段，续写后已完整结束。"
    And 不应显示流中断提示横幅

  @AGENT-STREAM-002 @P0
  Scenario: 自动续写失败后显示横幅并可手动继续
    Given 用户进入 TripYoYo AI 对话页面且已启用流恢复 Mock
    When 用户发送消息 "stream-fail"
    Then 应显示流中断提示横幅
    When 用户点击流中断横幅上的继续按钮
    Then 助手最终应显示完整回复 "这是未完成的回复片段，续写后已完整结束。"
    And 不应显示流中断提示横幅
