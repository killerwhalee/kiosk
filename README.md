# 초경량 주문 키오스크

행사장, 일일 찻집, 바자회, 축제 부스, 작은 카페처럼 **하루나 며칠 쓰는 주문 시스템**이 필요할 때,
노트북 한 대와 태블릿·휴대폰 몇 대만으로 바로 쓸 수 있는 주문 시스템입니다.

- **설치할 것이 Node.js 하나뿐**입니다. 외부 패키지·데이터베이스·빌드 과정이 없습니다.
- **인터넷이 없어도** 같은 와이파이 안에서 동작합니다. 아이콘과 화면 파일이 모두 저장소에 들어 있습니다.
- 메뉴·가격·테이블 수·주방 구성은 **`config.json` 파일 하나**로 바꿉니다.
- 태블릿·휴대폰에는 앱을 설치하지 않습니다. **브라우저로 주소만 열면** 됩니다.

```
[주문 입력 태블릿] ──▶ [서버 노트북] ──▶ [1번 주방 화면]  1번 주방이 만드는 메뉴만 표시
                                   ├─▶ [2번 주방 화면]  2번 주방이 만드는 메뉴만 표시
                                   └─▶ [관리자 화면]    매출·품절·주문 취소·초기화
```

주문을 넣으면 메뉴가 주방별로 나뉘어 각 주방 화면에 바로 뜨고, 알림음이 울립니다.
주방 담당자는 주문표를 보고 **주방에 요청 → 서빙 완료** 순서로 처리합니다.

## 빠른 시작

[Node.js](https://nodejs.org) 18 이상을 설치한 뒤:

```bash
git clone https://github.com/killerwhalee/kiosk.git
cd kiosk
npm start
```

Git이 없다면 GitHub 저장소 페이지에서 **Code → Download ZIP**으로 내려받아 압축을 풀고, 그 폴더에서 `npm start`를 실행해도 됩니다.

실행하면 접속 주소가 출력됩니다. 같은 와이파이에 연결된 태블릿에서 그 주소를 열면 됩니다.

```
우리 가게 주문 시스템이 시작되었습니다.
  이 컴퓨터에서: http://localhost:3000
  wlan0        http://192.168.0.12:3000
```

| 주소 | 누가 쓰나 | 하는 일 |
|---|---|---|
| `/` | 누구나 | 이 기기에서 쓸 화면을 고르는 시작 페이지 |
| `/order` | 주문받는 사람 | 테이블 선택 → 메뉴·수량 → 확인 → 전송 |
| `/station/1`, `/station/2`, … | 주방(서빙) 담당 | 자기 주방 주문 확인, 주방 요청, 서빙 완료 |
| `/admin` | 운영 책임자 | 매출·판매 수량, 품절 처리, 주문 취소, 초기화 |

## 내 가게에 맞게 바꾸기

`config.json`을 열어 수정하고 서버를 다시 시작합니다. 저장소에는 음료 코너와 주방이 있는 작은 카페를 예로 든 `config.json`이 들어 있습니다.

```json
{
  "title": "우리 가게",
  "tables": 8,
  "stations": [
    { "id": 1, "name": "음료" },
    { "id": 2, "name": "주방" }
  ],
  "menus": [
    { "id": "americano", "name": "아메리카노", "price": 3000, "station": 1 },
    { "id": "latte", "name": "카페라테", "price": 3500, "station": 1 },
    { "id": "lemonade", "name": "레몬에이드", "price": 4000, "station": 1 },
    { "id": "sandwich", "name": "샌드위치", "price": 5500, "station": 2 },
    { "id": "cheesecake", "name": "치즈케이크", "price": 5000, "station": 2 }
  ]
}
```

| 항목 | 설명 |
|---|---|
| `title` | 모든 화면 위에 표시되는 이름 |
| `port` | 서버 포트 (생략하면 3000) |
| `tables` | 테이블 개수. 주문 화면에 1번부터 이 번호까지 버튼이 생깁니다 |
| `stations` | 주방(준비 구역) 목록. 하나만 둬도 되고 여러 개여도 됩니다 |
| `menus` | 메뉴 목록. `station`에 그 메뉴를 만드는 주방의 `id`를 적습니다 |

포트, 관리자 PIN, 저장 파일 위치는 환경 변수로 바꿉니다.

| 변수 | 기본값 | 설명 |
|---|---|---|
| `PORT` | `config.json`의 `port`, 없으면 `3000` | 서버 포트 |
| `ADMIN_PIN` | 없음 | 설정하면 관리자 기능에 PIN이 필요합니다 |
| `KIOSK_DATA` | `data/state.json` | 주문 저장 파일 위치 |
| `KIOSK_CONFIG` | `config.json` | 설정 파일 위치 |

```bash
ADMIN_PIN=1234 npm start              # macOS / Linux
set ADMIN_PIN=1234&& npm start        # Windows (명령 프롬프트)
$env:ADMIN_PIN="1234"; npm start      # Windows (PowerShell)
```

## 매뉴얼

설치부터 당일 운영, 문제 해결까지 자세한 내용은 **[사용 매뉴얼](docs/MANUAL.md)**에 있습니다.

1. [설치하기](docs/MANUAL.md#1-설치하기)
2. [시작하기](docs/MANUAL.md#2-시작하기)
3. [태블릿 연결하기](docs/MANUAL.md#3-태블릿-연결하기)
4. [설정 바꾸기](docs/MANUAL.md#4-설정-바꾸기)
5. [화면별 사용법](docs/MANUAL.md#5-화면별-사용법)
6. [당일 운영 체크리스트](docs/MANUAL.md#6-당일-운영-체크리스트)
7. [문제가 생기면](docs/MANUAL.md#7-문제가-생기면)
8. [주문 데이터와 백업](docs/MANUAL.md#8-주문-데이터와-백업)

## 이런 경우에 맞습니다

- 하루~며칠 운영하는 행사, 주문 수백 건 규모
- 서버 역할을 할 노트북(또는 미니 PC) 한 대를 행사 내내 켜 둘 수 있을 때
- 결제는 따로 받고(현금·계좌이체·카드 단말기), 주문 전달과 매출 집계만 필요할 때

결제 연동, 영수증 출력, 손님이 직접 주문하는 기능, 여러 날짜 매출 비교는 없습니다.
화면 문구는 한국어, 금액은 원 단위로 표시됩니다.

## 개발

```bash
npm test     # 테스트 실행
```

- `server.js`: HTTP 서버, API, 실시간 전송(Server-Sent Events)
- `lib/store.js`: 주문 저장, 주방별 주문표 분리, 상태 변경
- `public/`: 각 화면 (빌드 과정 없는 HTML/JS)
- `public/icons.js`: 화면에서 쓰는 [Lucide](https://lucide.dev) 아이콘만 모은 파일입니다. 인터넷 없이도 아이콘이 보이도록 저장소에 포함했습니다.
  아이콘을 추가하려면 `scripts/build-icons.js`의 목록에 이름을 넣고 `npm install && npm run build:icons`를 실행합니다.
  서버 실행에는 `npm install`이 필요 없습니다.
- 테스트는 `config.json` 대신 `test/fixtures/config.json`을 사용하므로, `config.json`을 자유롭게 바꿔도 테스트에 영향이 없습니다.
