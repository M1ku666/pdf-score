# 操作说明

## 从B站视频导入

使用[BiliTabCapture](https://gitee.com/m1ku666/Bili-tab-capture/releases)可以从B站视频动态谱中截取谱面文件，导出本软件专用的`psz`谱面文件，附[介绍视频](https://www.bilibili.com/video/BV1KXgP6SEZ4)和[非大陆地区下载](https://github.com/m1ku666/Bili-tab-capture/releases)。

## 导入文件

将文件拖入窗口内任意位置或是点击乐谱库底部的「library.import」即可导入文件，支持的文件类型及导入效果如下：

- 新建乐谱：`pdf` `psz` `zip`
- 替换已打开乐谱的音频：`mp3` `wav` `m4a` `flac` ... `audio/*`
- 替换已打开乐谱的封面：`png` `jpg` `webp` `gif` ... `image/*`

> `psz` 是本软件专用乐谱文件格式，可从其他设备的乐谱库或[BiliTabCapture](https://gitee.com/m1ku666/Bili-tab-capture/releases)中导出，`zip`是包含多个`psz`文件的压缩包

新建乐谱时会自动识别行与小节线，请核对识别结果，用「store.tool.segment.label」添加速度与拍号信息，用「store.tool.jump.label」来标注反复记号。

## 音频

导入音频会自动打开「toolbar.audioPanel.offsetTitle」面板，请将中心线对准音频中第一小节的位置。

双击波形图可快速回到零秒位置，将「audio.pickup」打开时，中心线的位置被视作第二小节。

## 谱面拖动：「minimap.gesturePan」与「minimap.gesturePointer」

使用右上角工具栏中的「minimap.gesturePan」与「minimap.gesturePointer」来切换在谱面上的拖动行为：

- 「minimap.gesturePan」模式下，拖动时滚动谱面
- 「minimap.gesturePointer」模式下，拖动时框选循环段或使用编辑工具

## 播放/暂停

非编辑状态下双击谱面任意位置，或是使用空格键可播放/暂停，单击小节可跳转到该小节的位置。

## 设置行
使用「store.tool.row.label」来添加行。点击谱面任意位置添加行的一条边，再次点击谱面，将两次点击之间新建一行。也可以在「minimap.gesturePointer」模式下通过拖动直接创建行。点击已有行可删除。

## 设置小节线
使用「store.tool.bar.label」来添加小节线。点击行内空白位置添加小节线，点击小节线可删除。

## 设置段落
使用「store.tool.segment.label」来添加速度与拍号信息。点击小节线可新建段落，点击段落可编辑速度与拍号信息，为段落命名，或删除段落。

命名后的段落可以在播放工具栏的「toolbar.goto」中「goto.bySegment」。

## 设置反复记号

使用「store.tool.jump.label」来标注反复记号。先点击跳转起点小节线，再点击终点即可创建一个跳转，点击箭头可查看、编辑该跳转的信息或删除跳转。同一页内创建跳转也可以在「minimap.gesturePointer」模式下点击起点小节线，按住拖动到终点后松手创建。

用「store.tool.jump.label」中的「jump.addMember」之后，只有当前一条跳转已经成功触发后，才会触发后续跳转，以此实现多结束句，D.C.，Coda等复杂跳转。

## 管理标记

「minimap.title」中会用蓝色虚线标记出当前选中工具对应的标记出现的位置，拖动「minimap.title」栏或点击可以快速跳转。

在工具栏中再次点击已选中的工具，会打开「marks.title」面板，可以方便的管理乐谱中出现的全部标记。删除全部标记后可以点击「marks.autoMark」重新识别。

## 设置循环段

在「minimap.gesturePointer」模式下，不处于编辑状态是，拖动框选小节可设置循环段，循环段以灰色背景显示，再次点击可取消循环。

循环段不能单独包括未分组跳转标记的起点，或小组中第一个跳转标记的起点。
