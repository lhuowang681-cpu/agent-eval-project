@journey @P1 @skill
Feature: MCP Skill Quick Import

  Background:
    Given 用户已登录系统

  @SKILL-MCP-QUICKIMPORT-001
  Scenario: Quick import MCP with headers via JSON
    Given 用户打开技能管理页面
    When 用户点击添加技能按钮
    And 用户选择添加自定义 MCP 技能
    And 用户点击快速导入 JSON 配置按钮
    And 用户输入包含 headers 的 MCP JSON 配置
    And 用户点击导入按钮
    Then MCP 名称应被正确填充
    And MCP URL 应被正确填充
    And HTTP Headers 应被正确填充
