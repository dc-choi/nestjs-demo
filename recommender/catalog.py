"""Fixed product taxonomy and shared synthetic population allocations."""

from fractions import Fraction


GROUPS = (
    ("전자기기", 30),
    ("생활용품", 25),
    ("의류", 25),
    ("식품", 20),
)

# Category order is also the tie order for largest-remainder allocation.
CATEGORIES = (
    ("키보드", ("사무", "게임", "휴대", "입문"), ("저소음", "무선", "소형", "인체공학")),
    ("마우스", ("사무", "게임", "휴대", "디자인"), ("무선", "경량", "저소음", "인체공학")),
    ("모니터", ("사무", "게임", "디자인", "영상감상"), ("고해상도", "고주사율", "초광각", "시력보호")),
    ("헤드폰", ("출퇴근", "운동", "게임", "음악감상"), ("무선", "소음차단", "경량", "고음질")),
    ("충전기", ("사무", "휴대", "여행", "가정"), ("소형", "고속충전", "다중포트", "무선")),
    ("수납용품", ("책상", "주방", "의류보관", "여행"), ("접이식", "적층형", "투명", "방수")),
    ("청소용품", ("주방", "욕실", "차량", "바닥"), ("재사용", "일회용", "소형", "친환경")),
    ("조리도구", ("가정", "캠핑", "도시락", "제과"), ("경량", "내열", "비점착", "다기능")),
    ("침구", ("일상", "여름", "겨울", "손님용"), ("경량", "보온", "통기성", "세탁편의")),
    ("욕실용품", ("가정", "여행", "운동", "손님용"), ("속건", "소형", "친환경", "세탁편의")),
    ("상의", ("일상", "출근", "운동", "여행"), ("경량", "보온", "통기성", "신축성")),
    ("하의", ("일상", "출근", "운동", "야외활동"), ("경량", "보온", "통기성", "신축성")),
    ("외투", ("일상", "출근", "여행", "야외활동"), ("경량", "보온", "방수", "방풍")),
    ("신발", ("일상", "출근", "운동", "야외활동"), ("경량", "방수", "쿠션", "통기성")),
    ("가방", ("출근", "통학", "여행", "야외활동"), ("경량", "방수", "대용량", "소형")),
    ("간편식", ("일상", "도시락", "캠핑", "비상식"), ("고단백", "저당", "소포장", "혼합구성")),
    ("음료", ("일상", "운동", "사무", "선물"), ("저당", "무카페인", "소포장", "혼합구성")),
    ("과자", ("간식", "사무", "여행", "선물"), ("저당", "고단백", "소포장", "혼합구성")),
    ("견과", ("간식", "운동", "사무", "선물"), ("무염", "볶음", "소포장", "혼합구성")),
    ("조미료", ("가정", "캠핑", "도시락", "선물"), ("저염", "무가당", "소포장", "혼합구성")),
)

PRICE_TAGS = ("budget", "standard", "premium")
BRAND_TAGS = tuple("brand-%02d" % number for number in range(1, 21))
CATEGORY_WEIGHTS = tuple(weight for _, weight in GROUPS for _ in range(5))


def allocate_counts(total, weights):
    """Allocate integer counts, resolving equal remainders by input order."""
    if isinstance(total, bool) or not isinstance(total, int) or total < 0:
        raise ValueError("total must be a nonnegative integer")
    weights = [Fraction(str(weight)) for weight in weights]
    weight_sum = sum(weights)
    if not weights or any(weight < 0 for weight in weights) or weight_sum <= 0:
        raise ValueError("weights must be nonnegative with a positive sum")
    quotas = [total * weight / weight_sum for weight in weights]
    counts = [quota.numerator // quota.denominator for quota in quotas]
    order = sorted(range(len(weights)), key=lambda index: (-(quotas[index] - counts[index]), index))
    for index in order[:total - sum(counts)]:
        counts[index] += 1
    return counts
