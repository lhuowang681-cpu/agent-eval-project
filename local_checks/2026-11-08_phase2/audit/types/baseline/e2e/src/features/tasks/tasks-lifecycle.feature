@journey @task @P1
Feature: 定时任务(Tasks)— 状态流转(暂停/恢复)
  作为用户，我希望能通过任务卡片的右键菜单改变任务状态，例如暂停后再恢复。

  Background:
    Given 用户已登录系统
    And 用户进入任务列表页
    And 用户创建一个任务，指令为 "E2E 状态流转任务"
    And 用户返回任务列表页

  @TASK-LIFE-001 @P1
  Scenario: 暂停任务后再恢复
    When 用户通过右键菜单将任务 "E2E 状态流转任务" 状态设为 "Pending review"
    Then 任务 "E2E 状态流转任务" 的状态应为 "paused"
    When 用户通过右键菜单将任务 "E2E 状态流转任务" 状态设为 "Backlog"
    Then 任务 "E2E 状态流转任务" 的状态应为 "backlog"
