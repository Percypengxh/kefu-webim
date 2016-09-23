easemobim.channel = function ( config ) {
    var INITCONSTS = 30000;
    var CONSTS = 60000;
    var MAXRETRY = 1;


    var me = this;

    var utils = easemobim.utils;


        //监听ack的timer, 每条消息启动一个
    var ackTS = new easemobim.site(),

        //初始监听xmpp的timer, 如果30s后xmpp没有连接成功则处理按钮变为发送，走api发送消息
        firstTS,

        //发消息队列
        sendMsgSite = new easemobim.site(),

        //收消息队列
        receiveMsgSite = new easemobim.site();


    var api = easemobim.api;



    var _uuid = function () {
        var s = [],
            hexDigits = '0123456789abcdef';

        for ( var i = 0; i < 36; i++ ) {
            s[i] = hexDigits.substr(Math.floor(Math.random() * 0x10), 1);
        }

        s[14] = '4';
        s[19] = hexDigits.substr((s[19] & 0x3) | 0x8, 1);
        s[8] = s[13] = s[18] = s[23] = '-';
     
        return s.join('');
    };


    var _obj = {

        getConnection: function () {

            return new Easemob.im.Connection({ 
                url: config.xmppServer,
                retry: true,
                multiResources: config.resources,
                heartBeatWait: CONSTS
            });
        },

        reSend: function ( type, id ) {
            if ( id ) {
                var msg = sendMsgSite.get(id);

                switch ( type ) {

                    case 'txt':
                        _sendMsgChannle(msg, 0);//重试只发一次
                        break;
                }
            }
        },

        send: function ( type ) {

            var id = _uuid();

            switch ( type ) {

                case 'txt':
                    //不是历史记录开启倒计时
                    if ( !arguments[2] ) {
                        _detectSendMsgByApi(id);
                    }


                    _obj.sendText(arguments[1], arguments[2], arguments[3], id);
                    break;
                //转人工
                case 'transferToKf':
                    _detectSendMsgByApi(id);

                    _obj.transferToKf(arguments[1], arguments[2], id);
                    break;

                case 'img':
                    _obj.sendImg(arguments[1], arguments[2], id);
                    break;

                case 'file':
                    _obj.sendFile(arguments[1], arguments[2], id);
                    break;
                //满意度评价
                case 'satisfaction':
                    //不是历史记录开启倒计时, 当前只有文本消息支持降级
                    _detectSendMsgByApi(id);
                    _obj.sendSatisfaction(arguments[1], arguments[2], arguments[3], arguments[4], id);
                    break;
            };
        },

        appendAck: function ( msg, id ) {
            msg.body.ext.weichat.msg_id_for_ack = id;
        },

        sendSatisfaction: function ( level, content, session, invite, id ) {

            var msg = new Easemob.im.EmMessage('txt', id);
            msg.set({value: '', to: config.toUser});
            utils.extend(msg.body, {
                ext: {
                    weichat: {
                        ctrlType: 'enquiry'
                        , ctrlArgs: {
                            inviteId: invite || ''
                            , serviceSessionId: session || ''
                            , detail: content
                            , summary: level
                        }
                    }
                }
            });
            _obj.appendAck(msg, id);
            me.conn.send(msg.body);
            sendMsgSite.set(id, msg);
        },

        sendText: function ( message, isHistory, ext, id ) {

            var msg = new Easemob.im.EmMessage('txt', isHistory ? null : id);
            msg.set({
                value: message || easemobim.utils.encode(easemobim.textarea.value),
                to: config.toUser,
                success: function ( id ) {
                    // 此回调用于确认im server收到消息, 有别于kefu ack
                },
                fail: function ( id ) {
                    
                }
            });

            if ( ext ) {
                utils.extend(msg.body, ext);
            }

            utils.addClass(easemobim.sendBtn, 'disabled');
            if ( !isHistory ) {
                me.setExt(msg);
                _obj.appendAck(msg, id);
                me.conn.send(msg.body);
                sendMsgSite.set(id, msg);
                easemobim.textarea.value = '';
                if ( msg.body.ext && msg.body.ext.type === 'custom' ) { return; }
                me.appendDate(new Date().getTime(), config.toUser);
                me.appendMsg(config.user.username, config.toUser, msg);
            } else {
                me.appendMsg(config.user.username, isHistory, msg, true);
            }
        },


        transferToKf: function ( tid, sessionId, id ) {
            var msg = new Easemob.im.EmMessage('cmd', id);
            msg.set({
                to: config.toUser
                , action: 'TransferToKf'
                , ext: {
                    weichat: {
                        ctrlArgs: {
                            id: tid,
                            serviceSessionId: sessionId,
                        }
                    }
                }
            });

            _obj.appendAck(msg, id);
            me.conn.send(msg.body);
            sendMsgSite.set(id, msg);

            me.handleEventStatus(null, null, true);
        },

        sendImg: function ( file, isHistory, id ) {

            var msg = new Easemob.im.EmMessage('img', isHistory ? null : id);

            msg.set({
                apiUrl: (utils.ssl ? 'https://' : 'http://') + config.restServer,
                file: file || Easemob.im.Utils.getFileUrl(easemobim.realFile.getAttribute('id')),
                accessToken: me.token,
                to: config.toUser,
                uploadError: function ( error ) {
                    setTimeout(function () {
                        //显示图裂，无法重新发送
                        if ( !Easemob.im.Utils.isCanUploadFileAsync ) {
                            easemobim.swfupload && easemobim.swfupload.settings.upload_error_handler();
                        } else {
                            var id = error.id,
                                wrap = utils.$Dom(id);

                            utils.html(utils.$Class('a.easemobWidget-noline', wrap)[0], '<i class="easemobWidget-unimage">I</i>');
                            utils.addClass(utils.$Dom(id + '_loading'), 'em-hide');
                            me.scrollBottom();
                        }
                    }, 50);
                },
                uploadComplete: function () {
                    me.handleEventStatus();
                },
                success: function ( id ) {
                    utils.$Remove(utils.$Dom(id + '_loading'));
                    utils.$Remove(utils.$Dom(id + '_failed'));
                },
                fail: function ( id ) {
                    utils.addClass(utils.$Dom(id + '_loading'), 'em-hide');
                    utils.removeClass(utils.$Dom(id + '_failed'), 'em-hide');
                },
                flashUpload: easemobim.flashUpload
            });
            if ( !isHistory ) {
                me.setExt(msg);
                me.conn.send(msg.body);
                easemobim.realFile.value = '';
                if ( Easemob.im.Utils.isCanUploadFileAsync ) {
                    me.appendDate(new Date().getTime(), config.toUser);
                    me.appendMsg(config.user.username, config.toUser, msg);
                }
            } else {
                me.appendMsg(config.user.username, file.to, msg, true);
            }
        },

        sendFile: function ( file, isHistory, id ) {

            var msg = new Easemob.im.EmMessage('file', isHistory ? null : id),
                file = file || Easemob.im.Utils.getFileUrl(easemobim.realFile.getAttribute('id'));

            if ( !file || !file.filetype || !config.FILETYPE[file.filetype.toLowerCase()] ) {
                chat.errorPrompt('不支持此文件');
                easemobim.realFile.value = null;
                return false;
            }

            msg.set({
                apiUrl: (utils.ssl ? 'https://' : 'http://') + config.restServer,
                file: file,
                to: config.toUser,
                uploadError: function ( error ) {
                    //显示图裂，无法重新发送
                    if ( !Easemob.im.Utils.isCanUploadFileAsync ) {
                        easemobim.swfupload && easemobim.swfupload.settings.upload_error_handler();
                    } else {
                        var id = error.id,
                            wrap = utils.$Dom(id);

                        utils.html(utils.$Class('a.easemobWidget-noline')[0], '<i class="easemobWidget-unimage">I</i>');
                        utils.addClass(utils.$Dom(id + '_loading'), 'em-hide');
                        me.scrollBottom();
                    }
                },
                uploadComplete: function () {
                    me.handleEventStatus();
                },
                success: function ( id ) {
                    utils.$Remove(utils.$Dom(id + '_loading'));
                    utils.$Remove(utils.$Dom(id + '_failed'));
                },
                fail: function ( id ) {
                    utils.addClass(utils.$Dom(id + '_loading'), 'em-hide');
                    utils.removeClass(utils.$Dom(id + '_failed'), 'em-hide');
                },
                flashUpload: easemobim.flashUpload
            });
            if ( !isHistory ) {
                me.setExt(msg);
                me.conn.send(msg.body);
                easemobim.realFile.value = '';
                if ( Easemob.im.Utils.isCanUploadFileAsync ) {
                    me.appendDate(new Date().getTime(), config.toUser);
                    me.appendMsg(config.user.username, config.toUser, msg);
                }
            } else {
                me.appendMsg(config.user.username, file.to, msg, true);
            }
        },

        handleReceive: function ( msg, type, isHistory ) {
            if ( config.offDuty ) {
                return;
            }


            //如果是ack消息，清除ack对应的site item，返回
            if ( msg && msg.ext && msg.ext.weichat && msg.ext.weichat.ack_for_msg_id ) {

                var id = msg.ext.weichat.ack_for_msg_id;
                _clearTS(id);

                return;
            }



            var msgid = me.getMsgid(msg);

            if ( receiveMsgSite.get(msgid) ) {
                return;
            } else {
                msgid && receiveMsgSite.set(msgid, 1);
            }

            //绑定访客的情况有可能会收到多关联的消息，不是自己的不收
            if ( !isHistory && msg.from && msg.from.toLowerCase() != config.toUser.toLowerCase() && !msg.noprompt ) {
                return;
            }

            var message = null;

            if ( msg.ext && msg.ext.weichat && msg.ext.weichat.ctrlType && msg.ext.weichat.ctrlType == 'inviteEnquiry' ) {
                //满意度评价
                type = 'satisfactionEvaluation';  
            } else if ( msg.ext && msg.ext.msgtype && msg.ext.msgtype.choice ) {
                //机器人自定义菜单
                type = 'robertList';  
            } else if ( msg.ext && msg.ext.weichat && msg.ext.weichat.ctrlType === 'TransferToKfHint' ) {
                //机器人转人工
                type = 'robertTransfer';  
            }

            switch ( type ) {
                //text message
                case 'txt':
                case 'face':
                    message = new Easemob.im.EmMessage('txt');

                    message.set({value: isHistory ? msg.data : me.getSafeTextValue(msg)});
                    break;
                //emotion message
                /*case 'face':
                    message = new Easemob.im.EmMessage('txt');
                    var msgStr = '', brief = '';

                    for ( var i = 0, l = msg.data.length; i < l; i++ ) {

                        if ( msg.data[i].type === 'txt' ) {
                            var emoji = Easemob.im.Utils.parseEmotions(easemobim.utils.decode(msg.data[i].data));
                            if ( emoji.indexOf('<img') > -1 ) {
                                msg.data[i] = {
                                    data: emoji,
                                    emotion: true
                                };
                            }
                        }

                        brief += msg.data[i].type === 'emotion' ? "[表情]" : msg.data[i].data;
                        msgStr += msg.data[i].type === 'emotion' ? "\<img class=\'em-emotion\' src=\'" + msg.data[i].data + "\' alt=\'表情\'\/\>" : msg.data[i].data;
                    }
                    message.set({value: msgStr, emotion: true, brief: brief});
                    break;*/
                //image message
                case 'img':
                    message = new Easemob.im.EmMessage('img');

                    if ( msg.url ) {
                        message.set({file: {url: msg.url}});
                    } else {
                        try {
                            message.set({file: {url: msg.bodies[0].url}});
                        } catch ( e ) {}
                    }
                    break;
                //file message
                case 'file':
                    message = new Easemob.im.EmMessage('file');
                    if ( msg.url ) {
                        message.set({file: {url: msg.url, filename: msg.filename}});
                    } else {
                        try {
                            message.set({file: {url: msg.bodies[0].url, filename: msg.bodies[0].filename}});
                        } catch ( e ) {}
                    }
                    break;
                //satisfaction evaluation message
                case 'satisfactionEvaluation':
                    if(!isHistory){
                        // 创建隐藏的立即评价按钮，并触发click事件
                        var el = document.createElement('BUTTON');
                        el.className = 'js_satisfybtn';
                        el.style.display = 'none';
                        el.setAttribute('data-inviteid', msg.ext.weichat.ctrlArgs.inviteId);
                        el.setAttribute('data-servicesessionid', msg.ext.weichat.ctrlArgs.serviceSessionId);
                        document.body.appendChild(el);
                        utils.trigger(el, 'click');
                    }
                    break;
                //robert list message
                case 'robertList':
                    message = new Easemob.im.EmMessage('list');
                    var str = '',
                        robertV = msg.ext.msgtype.choice.items || msg.ext.msgtype.choice.list;

                    if ( robertV.length > 0 ) {
                        str = '<div class="easemobWidget-list-btns">';
                        for ( var i = 0, l = robertV.length; i < l; i++ ) {
                            str += '<button class="easemobWidget-list-btn js_robertbtn" data-id="' + robertV[i].id + '">' + (robertV[i].name || robertV[i]) + '</button>';
                        }
                        str += '</div>';
                    }
                    message.set({value: msg.ext.msgtype.choice.title, list: str});
                    break;
                //transfer from robert to agent
                case 'robertTransfer':
                    message = new Easemob.im.EmMessage('list');
                    var str = '',
                        robertV = [msg.ext.weichat.ctrlArgs];

                    if ( robertV.length > 0 ) {
                        str = '<div class="easemobWidget-list-btns">';
                        for ( var i = 0, l = robertV.length; i < l; i++ ) {
                            str += '<button class="easemobWidget-list-btn js_robertTransferBtn"\
                             data-sessionid="' + robertV[i].serviceSessionId + '" data-id="' + robertV[i].id + '">' + robertV[i].label + '</button>';
                        }
                        str += '</div>';
                    }
                    message.set({ value: msg.data || msg.ext.weichat.ctrlArgs.label, list: str });
                    break;
                default: break;
            }
            
            if ( !isHistory ) {

                if ( msg.ext && msg.ext.weichat ) {
                    if ( msg.ext.weichat.event 
                    && (msg.ext.weichat.event.eventName === 'ServiceSessionTransferedEvent' 
                    || msg.ext.weichat.event.eventName === 'ServiceSessionTransferedToAgentQueueEvent') ) {
                        //transfer msg, show transfer tip
                        me.handleEventStatus('transfer', msg.ext.weichat.event.eventObj);
                        me.updateAgentStatus();
                    } else if (  msg.ext.weichat.event && msg.ext.weichat.event.eventName === 'ServiceSessionClosedEvent' ) {
                        //service session closed event
                        me.session = null;
                        me.sessionSent = false;
                        me.handleEventStatus('close');
                        utils.root || transfer.send(easemobim.EVENTS.ONSESSIONCLOSED, window.transfer.to);
                    } else if ( msg.ext.weichat.event && msg.ext.weichat.event.eventName === 'ServiceSessionOpenedEvent' ) {
                        //service session opened event
                        //fake
                        me.needUpdateAgentStatus = true;
                        me.agentCount < 1 && (me.agentCount = 1);
                        me.handleEventStatus('linked', msg.ext.weichat.event.eventObj);
                    } else if ( msg.ext.weichat.event && msg.ext.weichat.event.eventName === 'ServiceSessionCreatedEvent' ) {
                        me.handleEventStatus('create');
                    } else if ( msg.ext.weichat.event && msg.ext.weichat.event.eventName === 'AgentStateChangedEvent' ) {
                        //客服状态改变通知
                        me.needUpdateAgentStatus = true;

                        //状态改变重新获取在线客服数量
                        me.getSession();
                        me.canUpdateAgentStatusDirectly && me.updateAgentStatusUI(msg.ext.weichat.event.eventObj.state);
                    } else {
                        if ( !msg.ext.weichat.agent ) {
                            //switch off
                            me.handleEventStatus('reply');
                        } else {
                            //switch on
                            msg.ext.weichat.agent && msg.ext.weichat.agent.userNickname !== '调度员' 
                            && me.handleEventStatus('reply', msg.ext.weichat.agent);
                        }
                    }
                }


                //空消息不显示
                if ( !message || !message.value ) {
                    return;
                }

                if ( !msg.noprompt ) {
                    me.messagePrompt(message);
                }
                me.appendDate(new Date().getTime(), msg.from);
                me.resetSpan();
                me.appendMsg(msg.from, msg.to, message);
                me.scrollBottom(50);

                if ( config.receive ) {
                    easemobim.EVENTS.ONMESSAGE.data = {
                        from: msg.from,
                        to: msg.to,
                        message: message
                    };
                    try {
                        utils.root || transfer.send(easemobim.EVENTS.ONMESSAGE, window.transfer.to);
                    } catch ( e ) {}
                }
            } else {
                if ( !message || !message.value ) {
                    return;
                }
                me.appendMsg(msg.from, msg.to, message, true);
            }
        },

        listen: function () {
                
            me.conn.listen({
                onOpened: function ( info ) {
                    
                    _clearFirstTS();

                    me.reOpen && clearTimeout(me.reOpen);
                    me.token = info.accessToken;
                    me.conn.setPresence();

                    if ( easemobim.textarea.value ) {
                        utils.removeClass(easemobim.sendBtn, 'disabled');
                    }
                    utils.html(easemobim.sendBtn, '发送');

                    me.handleReady(info);
                }
                , onTextMessage: function ( message ) {
                    me.receiveMsg(message, 'txt');
                }
                , onEmotionMessage: function ( message ) {
                    me.receiveMsg(message, 'face');
                }
                , onPictureMessage: function ( message ) {
                    me.receiveMsg(message, 'img');
                }
                , onFileMessage: function ( message ) {
                    me.receiveMsg(message, 'file');
                }
                , onCmdMessage: function ( message ) {
                    me.receiveMsg(message, 'cmd');
                }
                , onOnline: function () {
                    utils.isMobile && me.open();
                }
                , onOffline: function () {
                    utils.isMobile && me.conn.close();
                }
                , onError: function ( e ) {
                    if ( e.reconnect ) {
                        me.open();
                    } else if ( e.type === 2 ) {
                        me.reOpen || (me.reOpen = setTimeout(function () {
                            me.open();
                        }, 2000));
                    } else {
                        //me.conn.stopHeartBeat(me.conn);
                        typeof config.onerror === 'function' && config.onerror(e);
                    }
                }
            });
        },

        handleHistory: function ( chatHistory ) {

            if ( chatHistory.length > 0 ) {
                utils.each(chatHistory, function ( k, v ) {
                    var msgBody = v.body,
                        msg,
                        isSelf = msgBody.from === config.user.username;

                    if ( msgBody && msgBody.bodies.length > 0 ) {
                        msg = msgBody.bodies[0];
                        if ( msgBody.from === config.user.username ) {
                            //visitors' msg
                            switch ( msg.type ) {
                                case 'img':
                                    msg.url = /^http/.test(msg.url) ? msg.url : config.base + msg.url;
                                    msg.to = msgBody.to;
                                    me.sendImgMsg(msg, true);
                                    break;
                                case 'file':
                                    msg.url = /^http/.test(msg.url) ? msg.url : config.base + msg.url;
                                    msg.to = msgBody.to;
                                    me.sendFileMsg(msg, true);
                                    break;
                                case 'txt':
                                    me.sendTextMsg(msg.msg, true);
                                    break;
                            }
                        } else {
                            //agents' msg

                            //判断是否为满意度调查的消息
                            if ( msgBody.ext && msgBody.ext.weichat && msgBody.ext.weichat.ctrlType && msgBody.ext.weichat.ctrlType == 'inviteEnquiry'
                            //机器人自定义菜单
                            || msgBody.ext && msgBody.ext.msgtype && msgBody.ext.msgtype.choice
                            //机器人转人工
                            || msgBody.ext && msgBody.ext.weichat && msgBody.ext.weichat.ctrlType === 'TransferToKfHint' ) {
                                me.receiveMsg(msgBody, '', true);
                            } else {
                                var data = msg.msg;

                                msg.type === 'txt' && (data = me.getSafeTextValue(msgBody));

                                me.receiveMsg({
                                    msgId: v.msgId,
                                    data: data,
                                    filename: msg.filename,
                                    url: /^http/.test(msg.url) ? msg.url : config.base + msg.url,
                                    from: msgBody.from,
                                    to: msgBody.to
                                }, msg.type, true);
                            }
                        }

                        if ( msg.type === 'cmd'//1.cmd消息 
                        || (msg.type === 'txt' && !msg.msg)//2.空文本消息
                        || receiveMsgSite.get(v.msgId) ) {//3.重复消息
                            
                        } else {
                            me.appendDate(v.timestamp || msgBody.timestamp, isSelf ? msgBody.to : msgBody.from, true);
                        }
                    }
                });
            }
        }
    };


    //收消息轮训通道
    var _receiveMsgChannle = function () {

        if ( config.offDuty ) {
            return;
        }

        setInterval(function () {
            api('receiveMsgChannel', {
                orgName: config.orgName,
                appName: config.appName,
                easemobId: config.toUser,
                tenantId: config.tenantId,
                visitorEasemobId: config.user.username
            }, function ( msg ) {

                //处理收消息
                if ( msg && msg.data.status === 'OK' ) {
                    for ( var i = 0, l = msg.data.entities.length; i < l; i++ ) {
                        try {
                            _obj.handleReceive(msg.data.entities[i], msg.data.entities[i].bodies[0].type, false);
                        } catch ( e ) {}
                    }
                }
            });           
        }, CONSTS);
    };

    //发消息通道
    var _sendMsgChannle = function ( msg, count ) {
        var count = count === 0 ? 0 : (count || MAXRETRY);
        var id = msg.id;

        api('sendMsgChannel', {
            from: config.user.username,
            to: config.toUser,
            tenantId: config.tenantId,
            bodies: [{
                type: 'txt',
                msg: msg.value,
            }],
            ext: msg.body ? msg.body.ext : null,
            orgName: config.orgName,
            appName: config.appName,
            originType: config.originType || 'webim'
        }, function () {
            //发送成功清除
            _clearTS(id);
        }, function () {
            //失败继续重试
            if ( count > 0 ) {
                _sendMsgChannle(msg, --count);
            } else {
                utils.addClass(utils.$Dom(id + '_loading'), 'em-hide');
                utils.removeClass(utils.$Dom(id + '_failed'), 'em-hide');
            }
        });
    };

    //消息发送成功，清除timer
    var _clearTS = function ( id ) {

        clearTimeout(ackTS.get(id));
        ackTS.remove(id);

        utils.$Remove(utils.$Dom(id + '_loading'));
        utils.$Remove(utils.$Dom(id + '_failed'));
        
        if ( sendMsgSite.get(id) ) {
            me.handleEventStatus(null, null, sendMsgSite.get(id).value === '转人工' || sendMsgSite.get(id).value === '转人工客服');
        }

        sendMsgSite.remove(id);
    };

    //30s内连上xmpp后清除timer，暂不开启api通道发送消息
    var _clearFirstTS = function () {
        clearTimeout(firstTS);
    }

    //监听ack，超时则开启api通道, 发消息时调用
    var _detectSendMsgByApi = function ( id ) {

        ackTS.set(
            id,
            setTimeout(function () {
                //30s没收到ack使用api发送
                _sendMsgChannle(sendMsgSite.get(id));
            }, CONSTS)
        );
    };


    firstTS = setTimeout(function () {

        if ( easemobim.textarea.value ) {
            utils.removeClass(easemobim.sendBtn, 'disabled');
        }
        utils.html(easemobim.sendBtn, '发送');

        chat.handleReady();
    }, INITCONSTS);
    
    //收消息轮训通道常驻
    _receiveMsgChannle();

    return _obj;
};
