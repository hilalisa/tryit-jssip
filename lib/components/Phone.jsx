'use strict';

import React from 'react';
import CopyToClipboard from 'react-copy-to-clipboard';
import IconMenu from 'material-ui/IconMenu';
import MenuItem from 'material-ui/MenuItem';
import IconButton from 'material-ui/IconButton/IconButton';
import MoreVertIcon from 'material-ui/svg-icons/navigation/more-vert';
import JsSIP from 'jssip';
import UrlParse from 'url-parse';
import Logger from '../Logger';
import audioPlayer from '../audioPlayer';
import TransitionAppear from './TransitionAppear';
import Logo from './Logo';
import Dialer from './Dialer';
import Session from './Session';
import Incoming from './Incoming';

const jssipCallstats = window.jssipCallstats;

const logger = new Logger('Phone');

export default class Phone extends React.Component
{
	constructor(props)
	{
		super(props);

		this.state =
		{
			// 'connecting' / disconnected' / 'connected' / 'registered'
			status          : 'disconnected',
			session         : null,
			incomingSession : null
		};

		// Mounted flag
		this._mounted = false;
		// JsSIP.UA instance
		this._ua = null;
		// Site URL
		this._u = new UrlParse(window.location.href, true);
	}

	render()
	{
		let state = this.state;
		let props = this.props;
		let invitationLink = `${this._u.protocol}//${this._u.host}${this._u.pathname}?callme=${props.settings.uri}`;

		return (
			<TransitionAppear duration={1000}>
				<div data-component='Phone'>
					<header>
						<div className='topbar'>
							<Logo
								size='small'
							/>

							<IconMenu
								iconButtonElement={
									<IconButton>
										<MoreVertIcon color='#fff'/>
									</IconButton>
								}
								anchorOrigin={{ horizontal: 'right', vertical: 'top' }}
								targetOrigin={{ horizontal: 'right', vertical: 'top' }}
							>
								<CopyToClipboard text={invitationLink}
									onCopy={this.handleMenuCopyInvitationLink.bind(this)}
								>
									<MenuItem
										primaryText='Copy invitation link'
									/>
								</CopyToClipboard>
								<CopyToClipboard text={props.settings.uri || ''}
									onCopy={this.handleMenuCopyUri.bind(this)}
								>
									<MenuItem
										primaryText='Copy my SIP URI'
									/>
								</CopyToClipboard>
								<MenuItem
									primaryText='Exit'
									onClick={this.handleMenuExit.bind(this)}
								/>
							</IconMenu>
						</div>

						<Dialer
							settings={props.settings}
							status={state.status}
							busy={!!state.session || !!state.incomingSession}
							callme={this._u.query.callme}
							onCall={this.handleOutgoingCall.bind(this)}
						/>
					</header>

					<div className='content'>
						{state.session ?
							<Session
								session={state.session}
								onNotify={props.onNotify}
								onHideNotification={props.onHideNotification}
							/>
						:
							null
						}

						{state.incomingSession ?
							<Incoming
								session={state.incomingSession}
								onAnswer={this.handleAnswerIncoming.bind(this)}
								onReject={this.handleRejectIncoming.bind(this)}
							/>
						:
							null
						}
					</div>
				</div>
			</TransitionAppear>
		);
	}

	componentDidMount()
	{
		this._mounted = true;

		let settings = this.props.settings;
		let socket = new JsSIP.WebSocketInterface(settings.socket.uri);

		// TODO
		if (settings.socket.via_transport)
			socket.via_transport = settings.socket.via_transport;

		this._ua = new JsSIP.UA(
			{
				uri                 : settings.uri,
				password            : settings.password,
				display_name        : settings.display_name,
				sockets             : [ socket ],
				session_timers      : settings.session_timers,
				use_preloaded_route : settings.use_preloaded_route
			});

		this._ua.on('connecting', () =>
		{
			if (!this._mounted)
				return;

			logger.debug('UA "connecting" event');

			this.setState(
				{
					uri    : this._ua.configuration.uri.toString(),
					status : 'connecting'
				});
		});

		this._ua.on('connected', () =>
		{
			if (!this._mounted)
				return;

			logger.debug('UA "connected" event');

			this.setState({ status: 'connected' });
		});

		this._ua.on('disconnected', () =>
		{
			if (!this._mounted)
				return;

			logger.debug('UA "disconnected" event');

			this.setState({ status: 'disconnected' });
		});

		this._ua.on('registered', () =>
		{
			if (!this._mounted)
				return;

			logger.debug('UA "registered" event');

			this.setState({ status: 'registered' });
		});

		this._ua.on('unregistered', () =>
		{
			if (!this._mounted)
				return;

			logger.debug('UA "unregistered" event');

			if (this._ua.isConnected())
				this.setState({ status: 'connected' });
			else
				this.setState({ status: 'disconnected' });
		});

		this._ua.on('registrationFailed', (data) =>
		{
			if (!this._mounted)
				return;

			logger.debug('UA "registrationFailed" event');

			if (this._ua.isConnected())
				this.setState({ status: 'connected' });
			else
				this.setState({ status: 'disconnected' });

			this.props.onNotify(
				{
					level   : 'error',
					title   : 'Registration failed',
					message : data.cause
				});
		});

		this._ua.on('newRTCSession', (data) =>
		{
			if (!this._mounted)
				return;

			if (data.originator === 'local')
				return;

			logger.debug('UA "newRTCSession" event');

			let state = this.state;
			let session = data.session;

			// Avoid if busy or other incoming
			if (state.session || state.incomingSession) {
				logger.debug('incoming call replied with 486 "Busy Here"');

				session.terminate(
					{
						status_code   : 486,
						reason_phrase : 'Busy Here'
					});

				return;
			}

			audioPlayer.play('ringing');
			this.setState({ incomingSession: session });

			session.on('failed', () =>
			{
				audioPlayer.stop('ringing');
				this.setState(
					{
						session         : null,
						incomingSession : null
					});
			});

			session.on('ended', () =>
			{
				this.setState(
					{
						session         : null,
						incomingSession : null
					});
			});

			session.on('accepted', () =>
			{
				audioPlayer.stop('ringing');
				this.setState(
					{
						session         : session,
						incomingSession : null
					});
			});
		});

		this._ua.start();

		// Set callstats stuff
		jssipCallstats(
			// JsSIP.UA instance
			this._ua,
			// AppID
			'757893717',
			// AppSecret
			'zAWooDtrYJPo:OeNNdLBBk7nOq9mCS5qbxOhuzt6IdCvnx3cjNGj2tBo='
		);
	}

	componentWillUnmount()
	{
		this._mounted = false;
	}

	handleMenuCopyInvitationLink()
	{
		logger.debug('handleMenuCopyInvitationLink()');

		let message = 'Invitation link copied to the clipboard';

		this.props.onShowSnackbar(message, 3000);
	}

	handleMenuCopyUri()
	{
		logger.debug('handleMenuCopyUri()');

		let message = 'Your SIP URI copied to the clipboard';

		this.props.onShowSnackbar(message, 3000);
	}

	handleMenuExit()
	{
		logger.debug('handleMenuExit()');

		this._ua.stop();
		this.props.onExit();
	}

	handleOutgoingCall(uri)
	{
		logger.debug('handleOutgoingCall() [uri:"%s"]', uri);

		let session = this._ua.call(uri,
			{
				mediaConstraints :
				{
					audio : true,
					video : true
				},
				rtcOfferConstraints :
				{
					offerToReceiveAudio : 1,
					offerToReceiveVideo : 1
				}
			});

		session.on('connecting', () =>
		{
			this.setState({ session });
		});

		session.on('progress', () =>
		{
			audioPlayer.play('ringback');
		});

		session.on('failed', () =>
		{
			audioPlayer.stop('ringback');
			audioPlayer.play('rejected');
			this.setState({ session: null });
		});

		session.on('ended', () =>
		{
			audioPlayer.stop('ringback');
			this.setState({ session: null });
		});

		session.on('accepted', () =>
		{
			audioPlayer.stop('ringback');
			audioPlayer.play('answered');
		});
	}

	handleAnswerIncoming()
	{
		logger.debug('handleAnswerIncoming()');

		let session = this.state.incomingSession;

		session.answer();
	}

	handleRejectIncoming()
	{
		logger.debug('handleRejectIncoming()');

		let session = this.state.incomingSession;

		session.terminate();
	}
}

Phone.propTypes =
{
	settings           : React.PropTypes.object.isRequired,
	onNotify           : React.PropTypes.func.isRequired,
	onHideNotification : React.PropTypes.func.isRequired,
	onShowSnackbar     : React.PropTypes.func.isRequired,
	onHideSnackbar     : React.PropTypes.func.isRequired,
	onExit             : React.PropTypes.func.isRequired
};
