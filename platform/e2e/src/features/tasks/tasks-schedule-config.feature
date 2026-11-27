@journey @task @P1
Feature: 定时任务(Tasks)— 调度配置
  作为用户，我希望为任务配置定时(schedule)或心跳(heartbeat)自动化，
  配置应当即时保存并在刷新后保留。

  Background:
    Given 用户已登录系统
    And 用户进入任务列表页
    And 用户创建一个任务，指令为 "E2E 调度配置任务"

  @TASK-SCHED-001 @P1
  Scenario: 开启定时调度并在刷新后保留
    When 用户打开任务调度配置
    And 用户开启自动化
    Then 调度配置应处于已启用状态
    When 用户刷新当前页面
    Then 任务详情应显示已配置定时调度

  @TASK-SCHED-002 @P1
  Scenario: 切换到心跳(间隔)模式
    When 用户打开任务调度配置
    And 用户开启自动化
    And 用户切换到心跳模式
    Then 调度配置应显示心跳间隔设置

  @TASK-SCHED-003 @P1
  Scenario: 关闭自动化调度
    When 用户打开任务调度配置
    And 用户开启自动化
    And 用户关闭自动化
    Then 调度配置应显示自动化已关闭
