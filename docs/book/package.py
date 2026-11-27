"""Package the standalone textbook and explicitly selected project learning files."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import hashlib
import json
import re


def main():
    root = Path(__file__).resolve().parents[2]
    book = (root / 'docs/book/index.html').read_bytes()
    info = json.loads((root / 'docs/book/BUILD_INFO.json').read_text(encoding='utf-8'))
    if hashlib.sha256(book).hexdigest() != info['outputSha256']:
        raise ValueError('Book does not match its build record; rebuild before packaging.')
    output = root / 'deliverables'
    output.mkdir(exist_ok=True)
    version = re.search(r'\d+\.\d+', info['edition']).group(0)
    destination = output / f'Agent归因工程教材_{version}_跨电脑学习包_2026-10-23.zip'
    prefix = f'Agent归因工程教材_{version}/'
    instructions = '''Agent 轨迹评测与故障归因｜工程教材版 2.0
日期：2026-10-23

怎么阅读
把 ZIP 复制到新电脑，先完整解压，再用普通浏览器打开“双击打开_工程教材.html”。
无需安装运行环境，无须联网。先读“项目总介绍”，再读 E01。
正文以工程问题、机制、数据和状态、取舍、故障与验证为主，源码默认折叠。
包含6章18节工程正文、复习卡与完整参考回答、模拟面试流程。

已有笔记怎么迁移
旧电脑打开原手册，点“导出笔记与进度”，把得到的 JSON 一起带走。
新电脑打开新版教材，点“导入学习记录”，选择 JSON。
旧版格式兼容；会合并笔记和自评，恢复已导出的阅读页面、字号及配色。
ZIP 本身不自动包含浏览器中的私人笔记。请定期导出备份。

怎么让新电脑上的聊天助手继续教
本包还包含项目学习资料及 .github/skills/agent-eval-coach/SKILL.md。
把解压后的整个文件夹作为学习资料提供给新聊天，说明：
“请先读 HANDOFF.md 和 .github/skills/agent-eval-coach/SKILL.md，
按 LEARNING_PROGRESS.json 继续；工程讲解为主，新课先教，源码可选。”
这些文件没有自动安装到 Codex，也不需要安装才能离线阅读。
教学记录保存在 docs/learning/LEARNING_PROGRESS.json；初始未评估。
实际聊天会话后需携带更新后的记录文件，才能让新聊天读取真实进度。
浏览器自评与聊天教练评估是两种记录，不自动互相同步。

资料说明
项目参考来源、正文、原 Spec 和 Skill 适配说明都已包含，旧报告仅按来源引用。
参考代码集中在 source-reference，主教材不要求读这些文件。
这是学习与教学包，不是已经开发好的独立归因平台；个人离线闭环仍待实现。
没有虚构评分、准确率、个人开发历史或生产效果。
已检查章节与引用链接、18节正文、96个参考文件hash及压缩包完整性。
未声称完成浏览器视觉或交互实测。
'''
    instructions = instructions.replace('2.0', version).replace('包含6章18节工程正文、复习卡与完整参考回答、模拟面试流程。', '包含6章18节工程正文、复习卡与完整参考回答、模拟面试流程，以及A—J十阶段40个搭建任务。\n先看“项目搭建路线”再按任务进入教材；走通与新增实现分别记录，进度表是生成时快照。')
    selected = [root / name for name in ['README.md', 'HANDOFF.md', 'SOURCE_MANIFEST.json']]
    for directory in ['docs', 'source-reference', '.github/skills/agent-eval-coach']:
        selected.extend(p for p in (root / directory).rglob('*') if p.is_file() and '__pycache__' not in p.parts)
    paths = sorted(set(selected))
    with ZipFile(destination, 'w', compression=ZIP_DEFLATED, compresslevel=9) as archive:
        archive.writestr(prefix + '双击打开_工程教材.html', book)
        archive.writestr(prefix + '先读我_阅读与继续学习.txt', instructions.encode('utf-8-sig'))
        for item in paths:
            archive.write(item, prefix + item.relative_to(root).as_posix())
    with ZipFile(destination) as archive:
        if archive.testzip() is not None:
            raise ValueError('ZIP integrity failed')
        assert archive.read(prefix + '双击打开_工程教材.html') == book
        assert archive.read(prefix + 'docs/book/index.html') == book
        assert all(archive.read(prefix + p.relative_to(root).as_posix()) == p.read_bytes() for p in paths)
        print(json.dumps({'zip': str(destination), 'files': len(archive.namelist()), 'bytes': destination.stat().st_size, 'sha256': hashlib.sha256(destination.read_bytes()).hexdigest(), 'integrity': 'passed'}, ensure_ascii=True))


if __name__ == '__main__':
    main()
