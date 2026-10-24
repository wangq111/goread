/*
 * GoRead WiFi 传书网页端脚本（原生 JS 移植「有度」上传页 index.js 的交互行为）
 *
 * 页面结构：上传按钮（含隐藏 file input）/ 创建文件夹 / Refresh；
 * 上传进度面板（File Uploads in Progress）；面包屑 + 文件列表面板；新建/移动弹窗。
 * 接口对接本服务：/api/list、/api/mkdir、/api/move、/api/delete、/upload、/download。
 */
(function () {
  'use strict';

  var ENTER_KEYCODE = 13;

  /* 面包屑根节点显示名（服务端应用名，对齐参考页根节点显示设备名的做法） */
  var ROOT_NAME = 'GoRead';

  /* 当前相对目录（空串 = 上传根目录） */
  var _path = '';
  /* 重载禁用期间的待处理重载队列（对齐参考页的串行化刷新机制） */
  var _pendingReloads = [];
  /* 重载禁用计数（进入编辑/弹窗操作时暂停自动与手动刷新） */
  var _reloadingDisabled = 0;
  /* 进行中的上传请求数（>0 时暂停自动刷新） */
  var _uploading = 0;
  /* 是否正在内联重命名编辑 */
  var _editing = false;

  /**
   * 简化版选择器：返回第一个匹配元素
   *
   * 参数：sel CSS 选择器；root 查找根元素（默认 document）
   * 返回值：匹配的元素或 null
   */
  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  /**
   * 简化版选择器：返回全部匹配元素数组
   *
   * 参数：sel CSS 选择器；root 查找根元素（默认 document）
   * 返回值：匹配元素数组
   */
  function $all(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  /**
   * HTML 转义（防注入）
   *
   * 参数：s 原始字符串
   * 返回值：转义后的安全字符串
   */
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /**
   * 文件大小格式化（与参考页一致：1000 进制、两位小数，小于 1MB 一律显示 KB）
   *
   * 参数：bytes 字节数
   * 返回值：如 "2.74 MB" 的格式化文本
   */
  function formatFileSize(bytes) {
    if (bytes >= 1000000000) {
      return (bytes / 1000000000).toFixed(2) + ' GB';
    }
    if (bytes >= 1000000) {
      return (bytes / 1000000).toFixed(2) + ' MB';
    }
    return (bytes / 1000).toFixed(2) + ' KB';
  }

  /**
   * 追加一条 Bootstrap 提示条（可手动关闭）
   *
   * 参数：level 提示级别（danger/warning/success）；title 加粗标题；description 正文
   * 返回值：无
   */
  function _showAlert(level, title, description) {
    var div = document.createElement('div');
    div.className = 'alert alert-' + level + ' alert-dismissable';
    div.innerHTML = '<button type="button" class="close">&times;</button>' +
      '<strong>' + esc(title) + '</strong>' + esc(description);
    div.querySelector('.close').addEventListener('click', function () { div.remove(); });
    $('#alerts').prepend(div);
  }

  /**
   * 追加一条错误提示条（对齐参考页 _showError 行为）
   *
   * 参数：message 错误描述；textStatus 状态描述；errorThrown 错误摘要
   * 返回值：无
   */
  function _showError(message, textStatus, errorThrown) {
    _showAlert('danger', ((errorThrown && errorThrown !== '') ? errorThrown : textStatus) + ': ', message);
  }

  /**
   * 禁用列表刷新（编辑/上传等操作期间避免列表被自动刷新打断）
   *
   * 返回值：无
   */
  function _disableReloads() {
    _reloadingDisabled += 1;
  }

  /**
   * 重新启用列表刷新；若有挂起的重载请求则立即执行队首
   *
   * 返回值：无
   */
  function _enableReloads() {
    _reloadingDisabled -= 1;
    if (_reloadingDisabled <= 0 && _pendingReloads.length > 0) {
      _reload(_pendingReloads.shift());
    }
  }

  /**
   * 加载指定目录并列出内容（对齐参考页 _reload：含禁用计数、滚动位置保持、面包屑重建）
   *
   * 参数：path 相对目录路径（空串 = 根目录）
   * 返回值：无
   */
  function _reload(path) {
    if (_reloadingDisabled > 0) {
      if (_pendingReloads.indexOf(path) < 0) {
        _pendingReloads.push(path);
      }
      return;
    }

    _disableReloads();
    fetch('/api/list?dir=' + encodeURIComponent(path))
      .then(function (r) {
        if (!r.ok) { throw new Error('HTTP ' + r.status); }
        return r.json();
      })
      .then(function (data) {
        var scrollPosition = window.pageYOffset;

        if (path !== _path) {
          renderCrumb(path);
          _path = path;
        }
        renderListing(data.entries || []);

        window.scrollTo(0, scrollPosition);
      })
      .catch(function (err) {
        // 服务不可达时清空列表：避免残留过期记录让用户误以为还有已传输文件
        $('#listing').innerHTML = '';
        _showError('获取 "' + (path || '/') + '" 内容失败', 'Error', err.message);
      })
      .finally(function () {
        _enableReloads();
      });
  }

  /**
   * 渲染面包屑（根节点显示应用名，子目录逐级可点击回跳）
   *
   * 参数：path 相对目录路径（空串 = 根目录）
   * 返回值：无
   */
  function renderCrumb(path) {
    var ol = $('#path');
    ol.innerHTML = '';

    if (!path) {
      var rootLi = document.createElement('li');
      rootLi.className = 'active';
      rootLi.textContent = ROOT_NAME;
      ol.appendChild(rootLi);
      return;
    }

    var rootLink = document.createElement('li');
    rootLink.setAttribute('data-path', '');
    rootLink.innerHTML = '<a>' + esc(ROOT_NAME) + '</a>';
    ol.appendChild(rootLink);

    var components = path.split('/');
    for (var i = 0; i < components.length - 1; i++) {
      var subpath = components.slice(0, i + 1).join('/');
      var li = document.createElement('li');
      li.setAttribute('data-path', subpath);
      li.innerHTML = '<a>' + esc(components[i]) + '</a>';
      ol.appendChild(li);
    }

    var last = document.createElement('li');
    last.className = 'active';
    last.textContent = components[components.length - 1];
    ol.appendChild(last);

    $all('li[data-path]', ol).forEach(function (li) {
      li.addEventListener('click', function () {
        _reload(li.getAttribute('data-path'));
      });
    });
  }

  /**
   * 渲染文件列表（行结构对齐参考页 template-listing：图标/名称/大小/移动/删除）
   *
   * 参数：entries 服务端条目数组 [{name, size, is_dir}]
   * 返回值：无
   */
  function renderListing(entries) {
    var tbody = $('#listing');
    tbody.innerHTML = '';

    entries.forEach(function (it) {
      var tr = document.createElement('tr');
      tr.className = 'row-file';
      var itemPath = _path ? _path + '/' + it.name : it.name;
      tr.setAttribute('data-path', itemPath);
      tr.setAttribute('data-name', it.name);

      var iconBtn = it.is_dir
        ? '<button type="button" class="btn btn-default btn-xs button-open" title="打开"><span class="glyphicon glyphicon-folder-open"></span></button>'
        : '<button type="button" class="btn btn-default btn-xs button-download" title="下载"><span class="glyphicon glyphicon-download-alt"></span></button>';
      var sizeHtml = it.is_dir ? '' : '<p>' + esc(formatFileSize(it.size || 0)) + '</p>';

      tr.innerHTML =
        '<td class="column-icon">' + iconBtn + '</td>' +
        '<td class="column-name"><p class="edit">' + esc(it.name) + '</p></td>' +
        '<td class="column-size">' + sizeHtml + '</td>' +
        '<td class="column-move"><button type="button" class="btn btn-default btn-xs button-move" title="移动"><span class="glyphicon glyphicon-share-alt"></span></button></td>' +
        '<td class="column-delete"><button type="button" class="btn btn-danger btn-xs button-delete" title="删除"><span class="glyphicon glyphicon-trash"></span></button></td>';
      tbody.appendChild(tr);
    });

    bindRowHandlers(tbody);
  }

  /**
   * 为列表行绑定交互（下载/打开/移动/删除/点击重命名）
   *
   * 参数：root 列表 tbody 根元素
   * 返回值：无
   */
  function bindRowHandlers(root) {
    $all('.button-download', root).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var path = btn.closest('tr').getAttribute('data-path');
        setTimeout(function () {
          window.location = '/download?path=' + encodeURIComponent(path);
        }, 0);
      });
    });

    $all('.button-open', root).forEach(function (btn) {
      btn.addEventListener('click', function () {
        _reload(btn.closest('tr').getAttribute('data-path'));
      });
    });

    $all('.button-move', root).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var path = btn.closest('tr').getAttribute('data-path');
        var input = $('#move-input');
        input.value = path;
        input.setAttribute('data-path', path);
        showModal($('#move-modal'));
      });
    });

    $all('.button-delete', root).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var path = btn.closest('tr').getAttribute('data-path');
        /* 参考页无确认直接删除；此处保留确认对话框以防误删（安全加固） */
        if (!window.confirm('确定删除 "' + path + '" ？')) { return; }
        fetch('/api/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: path })
        })
          .then(function (r) {
            if (!r.ok) { throw new Error('HTTP ' + r.status); }
          })
          .catch(function (err) {
            _showError('删除 "' + path + '" 失败', 'Error', err.message);
          })
          .finally(function () {
            _reload(_path);
          });
      });
    });

    $all('.edit', root).forEach(function (p) {
      bindInlineRename(p);
    });
  }

  /**
   * 行内重命名（对齐参考页 jeditable 交互：点击名称进入编辑，Enter/失焦提交，Esc 取消）
   *
   * 参数：p 名称段落元素（其所属 tr 上带 data-path 与 data-name）
   * 返回值：无
   */
  function bindInlineRename(p) {
    p.title = 'Click to rename...';
    p.addEventListener('click', function () {
      if (_editing) { return; }
      _editing = true;
      _disableReloads();

      var original = p.textContent;
      var tr = p.closest('tr');
      var fromPath = tr.getAttribute('data-path');
      var name = tr.getAttribute('data-name');

      p.contentEditable = 'true';
      p.focus();
      var range = document.createRange();
      range.selectNodeContents(p);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);

      function commit() {
        p.contentEditable = 'false';
        _editing = false;
        _enableReloads();

        var value = p.textContent.trim();
        p.textContent = original;
        if (!value || value === name) { return; }
        var toPath = fromPath.slice(0, fromPath.length - name.length) + value;
        doMove(fromPath, toPath);
      }

      p.addEventListener('blur', function onBlur() {
        p.removeEventListener('blur', onBlur);
        commit();
      });
      p.addEventListener('keydown', function onKey(e) {
        if (e.keyCode === ENTER_KEYCODE) {
          e.preventDefault();
          p.removeEventListener('keydown', onKey);
          p.blur();
        } else if (e.keyCode === 27) {
          p.removeEventListener('keydown', onKey);
          p.textContent = original;
          p.blur();
        }
      });
    });
  }

  /**
   * 调用移动/重命名接口并刷新列表
   *
   * 参数：from 源相对路径；to 目标相对路径
   * 返回值：无
   */
  function doMove(from, to) {
    fetch('/api/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: from, to: to })
    })
      .then(function (r) {
        if (!r.ok) { throw new Error('HTTP ' + r.status); }
      })
      .catch(function (err) {
        _showError('移动 "' + from + '" 到 "' + to + '" 失败', 'Error', err.message);
      })
      .finally(function () {
        _reload(_path);
      });
  }

  /**
   * 显示 Bootstrap 风格弹窗（原生实现：backdrop + .in 过渡）
   *
   * 参数：modal 弹窗根元素
   * 返回值：无
   */
  function showModal(modal) {
    var backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop fade in';
    document.body.appendChild(backdrop);
    document.body.classList.add('modal-open');
    modal.style.display = 'block';
    /* 触发一次回流以播放淡入过渡 */
    void modal.offsetHeight;
    modal.classList.add('in');
    var input = modal.querySelector('input[type="text"]');
    if (input) {
      setTimeout(function () { input.focus(); input.select(); }, 150);
    }
  }

  /**
   * 隐藏 Bootstrap 风格弹窗并清理 backdrop
   *
   * 参数：modal 弹窗根元素
   * 返回值：无
   */
  function hideModal(modal) {
    modal.classList.remove('in');
    modal.style.display = 'none';
    $all('.modal-backdrop').forEach(function (b) { b.remove(); });
    document.body.classList.remove('modal-open');
  }

  /**
   * 批量上传：逐个文件串行上传（对齐参考页 sequentialUploads 行为）
   *
   * 参数：fileList FileList 或 File 数组
   * 返回值：无
   */
  function uploadFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) { return; }

    _uploading += files.length;
    $('.uploading').style.display = 'block';

    var chain = Promise.resolve();
    files.forEach(function (file) {
      chain = chain.then(function () { return uploadOne(file); });
    });
    chain.then(function () {
      _uploading = 0;
      $('.uploading').style.display = '';
      _reload(_path);
    });
  }

  /**
   * 上传单个文件：创建进度行、支持取消、完成后按结果给出提示
   *
   * 参数：file 待上传的 File 对象
   * 返回值：Promise（上传结束（含失败/取消）后 resolve）
   */
  function uploadOne(file) {
    return new Promise(function (resolve) {
      var row = document.createElement('tr');
      row.className = 'row-file';
      row.innerHTML =
        '<td class="column-icon"><button type="button" class="btn btn-warning btn-xs button-cancel" title="取消"><span class="glyphicon glyphicon-ban-circle"></span></button></td>' +
        '<td class="column-path"><p>' + esc((_path ? _path + '/' : '') + file.name) + '</p></td>' +
        '<td class="column-progress"><div class="progress"><div class="progress-bar" style="width:0%"></div></div></td>';
      $('#uploads').appendChild(row);

      var bar = row.querySelector('.progress-bar');
      var fd = new FormData();
      fd.append('dir', _path);
      fd.append('files', file, file.name);

      var xhr = new XMLHttpRequest();
      row.querySelector('.button-cancel').addEventListener('click', function () { xhr.abort(); });
      xhr.open('POST', '/upload');
      xhr.upload.onprogress = function (e) {
        if (e.lengthComputable) {
          bar.style.width = Math.floor(e.loaded / e.total * 100) + '%';
        }
      };
      xhr.onload = function () {
        row.remove();
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            var res = JSON.parse(xhr.responseText);
            if (res.skipped && res.skipped.length) {
              _showAlert('warning', '已跳过 ' + res.skipped.length + ' 个不支持的文件类型：', res.skipped.join('，'));
            }
          } catch (e2) { /* 响应非 JSON 时忽略 */ }
        } else {
          _showAlert('danger', '上传失败 "' + file.name + '"：', 'HTTP ' + xhr.status);
        }
        resolve();
      };
      xhr.onerror = function () {
        row.remove();
        _showAlert('danger', '上传失败 "' + file.name + '"：', '网络错误');
        resolve();
      };
      xhr.onabort = function () {
        row.remove();
        resolve();
      };
      xhr.send(fd);
    });
  }

  /* ===== 事件绑定 ===== */

  /* 上传按钮触发隐藏 file input（规避部分浏览器不弹出选择框的问题，对齐参考页做法） */
  $('#upload-file').addEventListener('click', function () {
    $('#fileupload').click();
  });
  /* 阻止 file input 点击冒泡到上传按钮导致二次触发 */
  $('#fileupload').addEventListener('click', function (e) {
    e.stopPropagation();
  });
  $('#fileupload').addEventListener('change', function () {
    if (this.files && this.files.length) {
      uploadFiles(this.files);
    }
    this.value = '';
  });

  /* 全页拖拽上传（对齐参考页 dropZone: document） */
  document.addEventListener('dragover', function (e) {
    e.preventDefault();
  });
  document.addEventListener('drop', function (e) {
    e.preventDefault();
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
      uploadFiles(e.dataTransfer.files);
    }
  });

  /* 新建文件夹弹窗 */
  $('#create-folder').addEventListener('click', function () {
    $('#create-input').value = 'Untitled folder';
    showModal($('#create-modal'));
  });
  $('#create-confirm').addEventListener('click', function () {
    hideModal($('#create-modal'));
    var name = $('#create-input').value.trim();
    if (!name) { return; }
    fetch('/api/mkdir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dir: _path, name: name })
    })
      .then(function (r) {
        if (!r.ok) { throw new Error('HTTP ' + r.status); }
      })
      .catch(function (err) {
        _showError('创建文件夹 "' + name + '" 失败', 'Error', err.message);
      })
      .finally(function () {
        _reload(_path);
      });
  });
  $('#create-input').addEventListener('keypress', function (e) {
    if (e.keyCode === ENTER_KEYCODE) {
      $('#create-confirm').click();
    }
  });

  /* 移动/重命名弹窗 */
  $('#move-confirm').addEventListener('click', function () {
    hideModal($('#move-modal'));
    var input = $('#move-input');
    var from = input.getAttribute('data-path');
    var to = input.value.trim();
    if (!to || to === from) { return; }
    doMove(from, to);
  });
  $('#move-input').addEventListener('keypress', function (e) {
    if (e.keyCode === ENTER_KEYCODE) {
      $('#move-confirm').click();
    }
  });

  /* 弹窗关闭按钮与 Esc 键 */
  $all('[data-dismiss="modal"]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      hideModal(btn.closest('.modal'));
    });
  });
  document.addEventListener('keydown', function (e) {
    if (e.keyCode === 27) {
      $all('.modal.in').forEach(hideModal);
    }
  });

  /* Refresh 按钮 */
  $('#reload').addEventListener('click', function () {
    _reload(_path);
  });

  /* 自动刷新（本页特有增强：同局域网其他设备上传后列表自动更新；编辑/上传/弹窗期间暂停） */
  setInterval(function () {
    if (_uploading > 0 || _editing || _reloadingDisabled > 0 || document.hidden) { return; }
    if ($('.modal.in')) { return; }
    _reload(_path);
  }, 3000);

  /* 初始加载根目录 */
  _reload('');
})();
