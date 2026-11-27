@journey @task @P0
Feature: 定时任务(Tasks)— 运行与后台定时执行
  作为用户，我希望能立即运行任务(Run now)，也希望到点的定时任务会被后台派发器
  自动执行。两者都应真实地发起一次运行(产生运行 topic)。

  Background:
    Given 用户已登录系统
    And 用户进入任务列表页

  @TASK-RUN-001 @P0
  Scenario: Run now 立即运行任务并产生运行记录
    When 用户创建一个任务，指令为 "E2E 立即运行任务"
    And 用户点击运行任务
    Then 任务应产生一次运行记录

  @TASK-AUTO-001 @P0
  Scenario: 到点的定时任务被后台派发器自动执行
    When 用户创建一个任务，指令为 "E2E 后台定时执行任务"
    And 将该任务设为立即到点的定时任务
    And 触发后台定时派发
    Then 派发结果应至少派发 1 个任务
    And 任务应产生一次运行记录

  @TASK-AUTO-002 @P1
  Scenario: dryRun 派发只统计不真正执行
    When 用户创建一个任务，指令为 "E2E dryRun 派发任务"
    And 将该任务设为立即到点的定时任务
    And 以 dryRun 触发后台定时派发
    Then 派发结果的实际派发数应为 0
