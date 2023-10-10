import React, {useState, useEffect, useRef, useMemo} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  SafeAreaView,
  ActivityIndicator,
  Image,
  Platform,
  Keyboard,
  ScrollView,
  Linking,
  KeyboardAvoidingView,
  Dimensions,
} from 'react-native';
import Voice from '@react-native-voice/voice';
import {GiftedChat, Send, Composer, Bubble} from 'react-native-gifted-chat';
import axios from 'axios';
import Tts from 'react-native-tts';
import BottomSheet, {BottomSheetBackdrop} from '@gorhom/bottom-sheet';
import {GestureHandlerRootView} from 'react-native-gesture-handler';
import moment from 'moment';
import 'moment/locale/ko';
import AsyncStorage from '@react-native-async-storage/async-storage';

const initAnswer = {
  _id: 2,
  text: '안녕하세요. OOO님!\nAI 챗봇이에요.\n무엇을 도와드릴까요?',
  createdAt: new Date(),
  quickReplies: {
    type: 'radio', // or 'checkbox',
    keepIt: true,
    values: [
      {
        title: '나의 건강상태',
        value: 'yes',
      },
      {
        title: '나에게 맞는 영양제',
        value: 'no',
      },
      {
        title: '나의 분석결과',
        value: 'yes',
      },
      {
        title: '복용중인 약',
        value: 'no',
      },
      {
        title: '챌린지',
        value: 'yes',
      },
      {
        title: '마이페이지',
        value: 'no',
      },
      {
        title: '맞춤형 케어',
        value: 'yes',
      },
    ],
  },
  user: {
    _id: 2,
    name: 'Bot',
  },
};

const isIphoneXs = [812, 844, 896, 926].includes(
  Dimensions.get('window').height,
);

const App = () => {
  const [isRecord, setIsRecord] = useState(false); // 음성 녹음 상태
  const isRecording = useRef(false); // 녹음 중 여부 (레퍼런스)
  const [word, setWord] = useState(''); // 입력된 텍스트
  const [voiceText, setVoiceText] = useState(''); // 음성 인식 결과 텍스트
  const timeout = useRef(null); // 음성 녹음 타임아웃 (레퍼런스)
  const initDelay = 7000; // 초기 음성 녹음 시간
  const continueDelay = 2000; // 계속해서 음성 녹음할 때의 시간
  const [isLoadingMessages, setIsLoadingMessages] = useState(false); // 메시지 로딩 중 여부
  const [isComposerFocused, setIsComposerFocused] = useState(false); // TextInput 포커스 여부

  const bottomSheetRef = useRef(null); // 하단 시트 레퍼런스

  const snapPoints = useMemo(() => [Platform.OS === 'ios' ? '32%' : '37%'], []); // 시트 높이 설정
  const [contentHeight, setContentHeight] = useState(0); // 시트 내용 높이

  // 초기 메시지 설정
  const [messageGroups, setMessageGroups] = useState({}); // 메시지 그룹 상태
  const currentMessageGroups = useRef(messageGroups); // 현재 메시지 그룹 레퍼런스

  const chatgptUrl = 'https://api.openai.com/v1/chat/completions';

  useEffect(() => {
    // AsyncStorage에서 메시지 그룹 로드
    loadMessageGroups();

    // 음성 인식 이벤트 리스너 설정
    Voice.onSpeechStart = _onSpeechStart;
    Voice.onSpeechEnd = _onSpeechEnd;
    Voice.onSpeechResults = _onSpeechResults;
    Voice.onSpeechError = _onSpeechError;

    // TTS 이벤트 리스너 설정
    Tts.addEventListener('tts-start');
    Tts.addEventListener('tts-finish');
    Tts.addEventListener('tts-cancel');

    // 언어 설정
    Tts.setDefaultLanguage('ko-KR');
    // 재생속도
    Tts.setDefaultRate(0.52);
    // 음의 높낮이
    Tts.setDefaultPitch(1.0);

    return () => {
      // 컴포넌트가 언마운트될 때 리스너 제거
      Voice.destroy().then(Voice.removeAllListeners);
    };
  }, []);

  // AsyncStorage에서 메시지 그룹 로드
  const loadMessageGroups = async () => {
    try {
      const initMessage = () => {
        const dateKey = moment().format('YYYYMMDD');
        const initGroup = {};
        initGroup[dateKey] = [];
        initGroup[dateKey].push(initAnswer);
        saveMessageGroups(initGroup);
      };

      const storedMessageGroups = await AsyncStorage.getItem('messageGroups');
      console.log('storedMessageGroups : ', storedMessageGroups);

      if (storedMessageGroups) {
        const allMessageGroups = JSON.parse(storedMessageGroups);

        // 현재 날짜로부터 이틀 전의 날짜를 계산합니다.
        const twoDaysAgo = moment().subtract(2, 'days').format('YYYYMMDD');

        // 이틀 전까지의 날짜 키를 가진 메시지 그룹 데이터만 필터링합니다.
        const filteredMessageGroups = Object.keys(allMessageGroups).reduce(
          (filtered, key) => {
            if (key >= twoDaysAgo) {
              filtered[key] = allMessageGroups[key];
            }
            return filtered;
          },
          {},
        );
        console.log('filteredMessageGroups: ', filteredMessageGroups);

        if (Object.keys(filteredMessageGroups).length !== 0) {
          setMessageGroups(filteredMessageGroups);
          currentMessageGroups.current = filteredMessageGroups;
        } else {
          initMessage();
        }
      } else {
        initMessage();
      }
    } catch (error) {
      console.error('Error loading message groups:', error);
    }
  };

  // AsyncStorage에 메시지 그룹 저장
  const saveMessageGroups = async updatedMessageGroups => {
    setMessageGroups(updatedMessageGroups);
    currentMessageGroups.current = updatedMessageGroups;
    try {
      await AsyncStorage.setItem(
        'messageGroups',
        JSON.stringify(updatedMessageGroups),
      );
    } catch (error) {
      console.error('Error saving message groups:', error);
    }
  };

  // 모든 메시지들을 배열로 합쳐 반환하는 함수
  const getMessageGroupsAsArray = () => {
    let allMessages = [];

    const today = new Date(); // 현재 날짜
    today.setHours(0, 0, 0, 0); // 시간을 00:00:00으로 설정
    const twoDaysAgo = new Date(today);
    twoDaysAgo.setDate(today.getDate() - 2); // 오늘로부터 2일 전 날짜

    const dateKeys = Object.keys(messageGroups);
    for (let i = dateKeys.length - 1; i >= 0; i--) {
      const dateKey = dateKeys[i];
      const year = dateKey.substring(0, 4);
      const month = parseInt(dateKey.substring(4, 6)) - 1;
      const day = parseInt(dateKey.substring(6, 8));

      const groupDate = new Date(year, month, day); // 그룹의 날짜

      if (groupDate >= twoDaysAgo) {
        allMessages = allMessages.concat(messageGroups[dateKey]);
      }
    }

    // 모든 메시지들을 시간 순서대로 정렬
    allMessages.sort((a, b) => {
      if (a.createdAt === b.createdAt) {
        return 0;
      }
      return a.createdAt > b.createdAt ? -1 : 1;
    });

    return allMessages;
  };

  // 외부 url 이동 핸들러
  const _goToUrl = async url => {
    await Linking.openURL(url).catch(err => console.error(err));
  };

  // 음성 인식 시작 이벤트 핸들러
  const _onSpeechStart = () => {
    console.log('onSpeechStart');
    setWord('');
  };

  // 음성 인식 종료 이벤트 핸들러
  const _onSpeechEnd = () => {
    console.log('onSpeechEnd');
  };

  // 음성 인식 결과 이벤트 핸들러
  const _onSpeechResults = event => {
    console.log('onSpeechResults', event);
    setVoiceText(event.value[0]);
    if (timeout.current) {
      clearTimeout(timeout.current);
    }
    timeout.current = setTimeout(
      () => handleTimeout(event.value[0]),
      continueDelay,
    );
  };

  // 음성 인식 에러 이벤트 핸들러
  const _onSpeechError = event => {
    console.log('_onSpeechError');
    console.log(event.error);
  };

  // 음성 녹음 시작 및 중지 메소드
  const _onRecordVoice = () => {
    if (isRecord) {
      // 음성 녹음 중지
      Voice.stop();
      clearTimeout(timeout.current);
    } else {
      setVoiceText('');
      // 음성 녹음 시작
      Voice.start('ko-KR')
        .then(res => {
          timeout.current = setTimeout(() => handleTimeout(), initDelay);
        })
        .catch(e => {
          console.log(e.error);
        });
    }
    setIsRecord(!isRecord);
    isRecording.current = !isRecording.current;
  };

  // 음성 녹음 시간 초과 처리 메소드
  const handleTimeout = (text = '') => {
    _stopListening(text);
  };

  // 음성 녹음 중지 메소드
  const _stopListening = msg => {
    if (isRecording.current) {
      Voice.stop()
        .then(res => {
          // 녹음된 음성을 메시지로 전송
          console.log('Voice Stopped');
          if (msg !== '') {
            const newMessages = [
              {
                _id: new Date().getTime() + 1,
                text: msg,
                createdAt: new Date(),
                user: {
                  _id: 1,
                },
              },
            ];
            onSend(newMessages);
            bottomSheetRef.current.close();
          }
        })
        .catch(e => {
          console.log(e.error);
        });
      setIsRecord(false);
      isRecording.current = false;
    }
  };

  // TextInput 포커스 이벤트 핸들러
  const onFocusHandler = () => {
    setIsComposerFocused(true);
  };

  // TextInput 블러 이벤트 핸들러
  const onBlurHandler = () => {
    setIsComposerFocused(false);
  };

  // 메시지 보내기 이벤트 핸들러
  const onSend = async (newMessages = []) => {
    setIsLoadingMessages(true);

    // 사용자 메시지를 채팅창에 추가
    const userMessage = newMessages[0];

    const updatedMessageGroups = {...currentMessageGroups.current};
    newMessages.forEach(message => {
      const dateKey = moment(message.createdAt).format('YYYYMMDD');
      if (!updatedMessageGroups[dateKey]) {
        updatedMessageGroups[dateKey] = [];
      }
      updatedMessageGroups[dateKey].unshift(message);
    });

    setMessageGroups(updatedMessageGroups);

    const response = await axios.post(
      chatgptUrl,
      {
        model: 'gpt-3.5-turbo',
        max_tokens: 10,
        messages: [
          {
            role: 'system',
            content: '',
          },
          {
            role: 'user',
            content: userMessage.text,
          },
        ],
      },
      {
        headers: {
          'Content-Type': 'application/json',
        },
      },
    );

    const result = response.data.choices[0].message.content;

    const bodyMessage = {
      _id: new Date().getTime() + 1,
      text: result,
      createdAt: new Date(),
      user: {
        _id: 2,
        name: 'Bot',
        avatar:
          'https://img.freepik.com/premium-vector/chatbot-icon-concept-chat-bot-or-chatterbot-robot-virtual-assistance-of-website_123447-1615.jpg',
      },
      move: [
        {title: '건강상태 한눈에 보기', value: 'https://naver.com'},
        {title: '나의 건강노트', value: 'https://naver.com'},
        {title: '나의 복약관리', value: 'https://naver.com'},
      ],
    };

    updatedMessageGroups[moment().format('YYYYMMDD')].unshift(bodyMessage);

    saveMessageGroups(updatedMessageGroups);

    setWord('');
    setIsLoadingMessages(false);
    Tts.speak(result);
  };

  // 빠른 응답 클릭 이벤트 핸들러
  const _onQuickReply = quickReply => {
    const newMessages = [
      {
        _id: new Date().getTime() + 1,
        text: quickReply.title,
        createdAt: new Date(),
        user: {
          _id: 1,
        },
      },
    ];
    onSend(newMessages);
  };

  // 상단 날짜 렌더링 함수
  const _renderDay = props => {
    const previousDate = moment(props.previousMessage?.createdAt).format(
      'YYYY.MM.DD',
    );
    const currentDate = moment(props.currentMessage.createdAt).format(
      'YYYY.MM.DD',
    );

    if (
      currentDate !== previousDate ||
      props.previousMessage?.createdAt === undefined
    ) {
      return (
        <View
          style={{
            alignItems: 'center',
            justifyContent: 'center',
            paddingVertical: 8,
          }}>
          <Text
            style={{
              padding: 8,
              borderRadius: 15,
              backgroundColor: 'white',
              overflow: 'hidden',
            }}>
            {moment(props.currentMessage.createdAt).format('YYYY.MM.DD dddd')}
          </Text>
        </View>
      );
    }
  };

  // 메시지 말풍선 커스텀 렌더링 함수
  const _renderBubble = props => {
    const msg = props.currentMessage;
    return (
      <View
        style={{
          alignItems: 'flex-start',
          justifyContent: 'flex-start',
        }}>
        {msg.user._id === 2 ? (
          <>
            <View style={{flexDirection: 'row', marginBottom: 7}}>
              <View
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 30 / 2,
                  overflow: 'hidden',
                }}>
                <Image
                  source={{
                    uri: 'https://img.freepik.com/premium-vector/chatbot-icon-concept-chat-bot-or-chatterbot-robot-virtual-assistance-of-website_123447-1615.jpg',
                  }}
                  style={{width: 30, height: 30}}
                />
              </View>
              <Text
                style={{
                  color: 'gray',
                  fontSize: 12,
                  alignSelf: 'flex-end',
                  marginLeft: 5,
                }}>
                {moment(props.currentMessage.createdAt).format('a h:mm')}
              </Text>
            </View>
            <Bubble
              {...props}
              wrapperStyle={{
                left: {
                  borderTopLeftRadius: 0,
                  padding: 5,
                  backgroundColor: 'white',
                },
              }}
              renderCustomView={() => {
                // 말풍선 안 버튼 커스텀뷰
                if (props.currentMessage?.move) {
                  return (
                    <View
                      style={{
                        marginLeft: 10,
                      }}>
                      {props.currentMessage?.move.map((item, index) => {
                        return (
                          <TouchableOpacity
                            style={{
                              backgroundColor: '#6257ff',
                              paddingVertical: 10,
                              paddingHorizontal: 30,
                              marginVertical: 5,
                              borderRadius: 5,
                              flexDirection: 'row',
                              justifyContent: 'center',
                            }}
                            key={index}
                            onPress={() => _goToUrl(item.value)}>
                            <Text style={{color: 'white', marginRight: 5}}>
                              {item.title}
                            </Text>
                            <Image source={require('./img/moveWhite.png')} />
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  );
                } else {
                  return null;
                }
              }}
              isCustomViewBottom={true}
            />
          </>
        ) : (
          <>
            <Bubble
              {...props}
              wrapperStyle={{
                right: {
                  borderTopRightRadius: 0,
                  padding: 5,
                  backgroundColor: '#6257ff',
                  marginTop: 10,
                },
              }}
            />
            <Text
              style={{
                color: 'gray',
                fontSize: 12,
                alignSelf: 'flex-end',
                marginTop: 5,
              }}>
              {moment(props.currentMessage.createdAt).format('a h:mm')}
            </Text>
          </>
        )}
      </View>
    );
  };

  // 빠른 응답 커스텀 렌더링 함수
  const _renderQuickReplies = props => {
    const {currentMessage, onQuickReply} = props;
    const quickReplies = currentMessage?.quickReplies || [];

    if (quickReplies.length === 0) {
      return null;
    }

    const replyItem = (reply, index) => {
      return (
        <TouchableOpacity
          key={index}
          onPress={() => onQuickReply(reply)}
          style={{
            backgroundColor: 'white',
            borderRadius: 20,
            paddingHorizontal: 12,
            paddingVertical: 8,
            marginRight: 10,
            marginTop: 10,
          }}>
          <Text
            style={{
              fontSize: 13,
              color: '#6257ff',
            }}>
            {reply.title}
          </Text>
        </TouchableOpacity>
      );
    };

    return (
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
        }}>
        {quickReplies.values.map((reply, index) => replyItem(reply, index))}
      </View>
    );
  };

  const HighlightWord = ({sentences, targetWord}) => {
    const highlightedSentences = sentences
      .filter(sentence =>
        sentence.toLowerCase().includes(targetWord.toLowerCase()),
      )
      .map((sentence, index) => {
        const parts = sentence.split(new RegExp(`(${targetWord})`, 'gi'));
        const styledParts = parts.map((part, index) => {
          if (part.toLowerCase() === targetWord.toLowerCase()) {
            return (
              <Text key={index} style={{color: 'red'}}>
                {part}
              </Text>
            );
          }
          return <Text key={index}>{part}</Text>;
        });

        return (
          <TouchableOpacity
            key={index}
            style={{
              flexDirection: 'row', // 가로로 배치
              alignItems: 'center', // 가운데 정렬
              flexWrap: 'wrap',
              marginHorizontal: 10,
              marginBottom: 15,
              marginTop: index === 0 ? 15 : 0,
            }}
            onPress={() => {
              const newMessages = [
                {
                  _id: new Date().getTime() + 1,
                  text: sentences[index],
                  createdAt: new Date(),
                  user: {
                    _id: 1,
                  },
                },
              ];
              onSend(newMessages);
              setWord('');
            }}>
            {styledParts}
          </TouchableOpacity>
        );
      });

    return <View>{highlightedSentences}</View>;
  };

  // 입력 툴바 커스텀 렌더링 함수
  const _renderInputToolbar = props => {
    return (
      <View
        style={{
          width: '100%',
          position: 'absolute',
          bottom: 0,
        }}>
        <ScrollView
          style={
            word === '' || word.length < 2
              ? {display: 'none'}
              : {
                  backgroundColor: 'white',
                  flex: 1,
                  maxHeight: 200,
                }
          }
          keyboardShouldPersistTaps={'handled'}>
          <HighlightWord
            sentences={[
              '스트레스 자가진단 해보기',
              '나의 스트레스 발생원인 보기',
              '나의 스트레스 맞춤 추천 제품 보기',
              '스트레스 / 심박수 측정하기',
              '나의 건강검진 보기',
              '셀프건강체크 하기',
            ]}
            targetWord={word}
          />
        </ScrollView>
        <View
          style={{
            flexDirection: 'row',
            backgroundColor: 'white',
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            height: 45,
          }}>
          <Composer
            {...props}
            textInputStyle={{
              marginRight: 10,
              paddingLeft: 15,
              paddingRight: 70,
              borderRadius: 20,
              borderWidth: 2,
              borderColor: isComposerFocused ? '#6257ff' : 'lightgray',
            }}
            onTextChanged={text => setWord(text)}
            placeholder={'궁금한 점을 입력하세요.'}
            multiline={false}
            textInputProps={{
              onFocus: onFocusHandler,
              onBlur: onBlurHandler,
            }}
          />
          {word === '' ? (
            <TouchableOpacity
              onPress={() => {
                Keyboard.dismiss();
                _onRecordVoice();
                bottomSheetRef.current.snapToIndex(0);
              }}
              style={{position: 'absolute', right: 27, top: 13}}>
              <Image
                source={require('./img/mike.png')}
                style={{height: 20, width: 20}}
              />
            </TouchableOpacity>
          ) : (
            <View
              style={{
                position: 'absolute',
                right: 30,
                top: 15,
                flexDirection: 'row',
              }}>
              <TouchableOpacity
                onPress={() => setWord('')}
                style={{height: 16, width: 16, marginRight: 10}}>
                <Image source={require('./img/close.png')} />
              </TouchableOpacity>
              <Send {...props} containerStyle={{height: 16, width: 16}}>
                <Image source={require('./img/send.png')} />
              </Send>
            </View>
          )}
        </View>
      </View>
    );
  };

  // 하단 로딩 뷰 렌더링 함수
  const _renderFooter = () => {
    return isLoadingMessages ? (
      <ActivityIndicator size="large" color="red" />
    ) : null;
  };

  return (
    <GestureHandlerRootView style={{flex: 1}}>
      <SafeAreaView style={{flex: 1, backgroundColor: '#edebeb'}}>
        <KeyboardAvoidingView
          style={{flex: 1}}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <GiftedChat
            isKeyboardInternallyHandled={false}
            bottomOffset={Platform.OS === 'ios' ? 36 : 0}
            disableComposer={isLoadingMessages}
            keyboardShouldPersistTaps={'handled'}
            alignTop={true}
            messages={getMessageGroupsAsArray()}
            alwaysShowSend={true}
            text={word}
            locale="ko"
            user={{
              _id: 1,
            }}
            onSend={newMessages => {
              onSend(newMessages);
              setWord('');
            }}
            onQuickReply={_onQuickReply} // 빠른 응답 클릭 메소드
            renderDay={_renderDay} // 상단 날짜 표시
            renderBubble={_renderBubble} // 말풍선 커스텀
            renderQuickReplies={_renderQuickReplies} // 빠른 응답 커스텀
            renderInputToolbar={_renderInputToolbar} // TextInput 커스텀
            renderFooter={_renderFooter} // 하단 로딩뷰
            renderAvatar={() => null} // 사용자 아바타
            renderTime={() => null} // 메시지 시간
          />
        </KeyboardAvoidingView>
      </SafeAreaView>
      <View
        style={{
          height: Platform.OS === 'ios' ? (isIphoneXs ? 34 : 0) : 0,
          backgroundColor: 'white',
        }}
      />
      <BottomSheet
        ref={bottomSheetRef}
        index={-1}
        enablePanDownToClose={false}
        snapPoints={snapPoints}
        backdropComponent={backdropProps => (
          <BottomSheetBackdrop
            {...backdropProps}
            appearsOnIndex={0}
            disappearsOnIndex={-1}
            pressBehavior={'collapse'}
            onPress={() => {
              bottomSheetRef.current.close();
            }}
          />
        )}
        handleComponent={() => null}
        onChange={index => {
          if (index === -1) {
            Voice.stop();
            clearTimeout(timeout.current);
            setIsRecord(false);
            isRecording.current = false;
          }
        }}>
        <View>
          <TouchableOpacity
            style={{
              width: 32,
              height: 32,
              justifyContent: 'center',
              alignItems: 'center',
              alignSelf: 'flex-end',
              paddingTop: 10,
              paddingRight: 10,
            }}
            onPress={() => {
              bottomSheetRef.current.close();
            }}>
            <Image source={require('./img/close_sheet.png')} />
          </TouchableOpacity>
          <View style={{alignItems: 'center', marginTop: 10}}>
            {voiceText === '' ? (
              <View
                style={{
                  width: '100%',
                  height: 105,
                  alignItems: 'center',
                }}>
                <Text style={{fontSize: 18, fontWeight: 'bold'}}>
                  음성으로 말해보세요.
                </Text>
                <View style={{marginTop: 20, alignItems: 'center'}}>
                  <Text style={{color: '#6257ff', lineHeight: 20}}>
                    "나의 건강상태 알려줘"
                  </Text>
                  <Text style={{color: '#6257ff', lineHeight: 20}}>
                    "오늘 약 뭐 먹는지 알려줘"
                  </Text>
                  <Text style={{color: '#6257ff', lineHeight: 20}}>
                    "영양제 추천해줘"
                  </Text>
                </View>
              </View>
            ) : (
              <ScrollView
                style={{
                  width: '95%',
                  height: 105,
                }}
                scrollEnabled={contentHeight > 105}
                contentContainerStyle={{
                  flexGrow: 1,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                <Text
                  style={{
                    fontSize: 18,
                    fontWeight: 'bold',
                  }}
                  onLayout={event =>
                    setContentHeight(event.nativeEvent.layout.height)
                  }>
                  {voiceText}
                </Text>
              </ScrollView>
            )}
            <TouchableOpacity
              style={
                isRecord
                  ? {
                      backgroundColor: '#6257ff',
                      borderRadius: 50,
                      padding: 12,
                      marginTop: 20,
                    }
                  : {
                      borderWidth: 1,
                      borderRadius: 50,
                      padding: 12,
                      marginTop: 20,
                    }
              }
              onPress={_onRecordVoice}>
              <Image
                source={
                  isRecord
                    ? require('./img/miconWhite.png')
                    : require('./img/micoff.png')
                }
              />
            </TouchableOpacity>
          </View>
        </View>
      </BottomSheet>
    </GestureHandlerRootView>
  );
};

export default App;
