@journey @task @P0
Feature: 定时任务(Tasks)— 基础 CRUD
  作为用户，我希望能创建任务、在列表中看到它、编辑标题、并删除它，
  这是定时任务系统最基础的用户旅程。

  Background:
    Given 用户已登录系统
    And 用户进入任务列表页

  @TASK-CRUD-001 @P0
  Scenario: 创建任务并进入详情页
    When 用户创建一个任务，指令为 "E2E 写一份今天的工作总结"
    Then 页面应该跳转到任务详情页
    And 任务详情标题应包含 "E2E 写一份今天的工作总结"

  @TASK-CRUD-002 @P0
  Scenario: 新建的任务出现在任务列表
    When 用户创建一个任务，指令为 "E2E 列表可见性校验任务"
    And 用户返回任务列表页
    Then 任务列表中应出现 "E2E 列表可见性校验任务"

  @TASK-CRUD-003 @P0
  Scenario: 编辑任务标题后刷新仍保留
    When 用户创建一个任务，指令为 "E2E 待改名任务"
    And 用户将任务标题改为 "E2E 已改名任务"
    And 用户刷新当前页面
    Then 任务详情标题应包含 "E2E 已改名任务"

  @TASK-CRUD-004 @P0
  Scenario: 删除任务后从列表消失
    When 用户创建一个任务，指令为 "E2E 待删除任务"
    And 用户返回任务列表页
    And 用户右键删除任务 "E2E 待删除任务"
    Then 任务列表中不应出现 "E2E 待删除任务"
