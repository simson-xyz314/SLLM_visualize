"""
sLLM 추론 과정을 스텝 단위로 기록해 프론트엔드용 JSON으로 저장한다.
학습이 아니라 이미 학습된 모델의 forward pass를 직접 돌려서
실제 어텐션 가중치와 다음 토큰 확률분포를 뽑아낸다.
"""

import json
import sys
from pathlib import Path

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

MODEL_NAME = "Qwen/Qwen2.5-0.5B-Instruct"
MAX_NEW_TOKENS = 40
TOP_K = 6
ATTENDED_TOP_N = 5  # 새 토큰이 주목하는 이전 토큰 중 상위 N개만 기록


def _common_prefix_len(a: str, b: str) -> int:
    n = min(len(a), len(b))
    for i in range(n):
        if a[i] != b[i]:
            return i
    return n


def ids_to_pieces(tokenizer, ids: list[int]) -> list[str]:
    """id를 하나씩 따로 decode하면 한글처럼 여러 바이트로 쪼개지는 토큰이
    깨진 문자(�)로 나온다. 누적 시퀀스를 decode한 뒤 이전 결과와 공통되지
    않는 꼬리만 떼어내는 방식으로 각 토큰이 실제로 보여주는 글자 조각을
    복원한다 (바이트가 늦게 합쳐지며 앞부분 문자가 바뀌는 경우까지 대응)."""
    pieces = []
    prev_text = ""
    for i in range(1, len(ids) + 1):
        cur_text = tokenizer.decode(ids[:i], skip_special_tokens=False)
        common = _common_prefix_len(prev_text, cur_text)
        pieces.append(cur_text[common:])
        prev_text = cur_text
    return pieces


def decode_next_piece(tokenizer, base_ids: list[int], next_id: int) -> str:
    base_text = tokenizer.decode(base_ids, skip_special_tokens=False)
    full_text = tokenizer.decode(base_ids + [next_id], skip_special_tokens=False)
    common = _common_prefix_len(base_text, full_text)
    return full_text[common:]


# 임베딩 장면의 "점 구름" 배경으로 쓸 고정된 기준 단어들 — 매번 같은 단어를
# 써야, 질문마다 그 벡터가 이 기준점들 사이 어디에 자리 잡는지 비교가 된다.
REFERENCE_WORDS = [
    "사랑", "전쟁", "행복", "슬픔", "분노", "기쁨", "불안", "평온", "희망", "절망",
    "긴장", "만족", "후회", "질투", "공포", "놀람", "수치", "자부심", "외로움", "그리움",
    "바다", "산", "강", "하늘", "별", "달", "태양", "바람", "비", "눈",
    "구름", "폭풍", "번개", "무지개", "숲", "사막", "화산", "빙하", "계곡", "호수",
    "시간", "과거", "미래", "현재", "순간", "영원", "아침", "저녁", "밤", "새벽",
    "봄", "여름", "가을", "겨울", "세기",
    "평화", "자유", "정의", "법률", "정치", "정부", "국가", "민주주의", "혁명", "권력",
    "외교", "선거", "헌법", "인권", "평등", "갈등", "협력", "연대", "전통", "관습",
    "돈", "경제", "시장", "투자", "무역", "화폐", "은행", "주식", "부채", "자본",
    "소비", "생산", "노동", "실업", "물가",
    "과학", "기술", "물리학", "화학", "생물학", "수학", "우주", "로봇", "인공지능", "컴퓨터",
    "인터넷", "에너지", "원자", "중력", "진화", "유전자", "바이러스", "백신", "전기", "자기장",
    "가족", "친구", "부모", "자녀", "형제", "자매", "결혼", "이혼", "우정", "신뢰",
    "배신", "화해", "이별", "재회", "이웃",
    "음악", "미술", "문학", "영화", "연극", "춤", "사진", "조각", "건축", "디자인",
    "패션", "축제", "박물관", "공연", "소설", "시", "그림", "악기", "합창", "무대",
    "종교", "철학", "신", "영혼", "운명", "윤리", "도덕", "진리", "존재", "의식",
    "깨달음", "명상", "기도", "죄", "구원",
    "학교", "교육", "학생", "교사", "대학", "시험", "지식", "공부", "졸업", "입학",
    "수업", "연구",
    "회사", "직업", "의사", "변호사", "농부", "어부", "군인", "경찰", "소방관", "요리사",
    "예술가", "기자", "작가", "교수", "상인",
    "건강", "질병", "생명", "죽음", "신체", "마음", "뇌", "심장", "혈액", "수면",
    "식사", "치료", "휴식", "통증", "체력",
    "동물", "식물", "나무", "꽃", "새", "물고기", "곤충", "사자", "호랑이", "코끼리",
    "고래", "독수리", "나비", "장미", "소나무", "대나무", "풀", "열매", "씨앗", "뿌리",
    "도시", "마을", "대륙", "거리", "건물", "집", "다리", "항구", "공항", "기차역",
    "광장", "공원", "골목", "마당", "병원",
    "여행", "이동", "자동차", "기차", "비행기", "배", "자전거", "도로", "철도", "지도",
    "나침반", "여권",
    "언어", "단어", "문장", "대화", "소통", "번역", "글자", "책", "신문", "방송",
    "편지", "전화", "메시지", "침묵", "소문",
    "의미", "개념", "관계", "문맥", "맥락", "주제", "의도", "추론", "패턴", "연결",
    "구조", "논리", "증거", "원인", "결과", "목적", "방법", "과정", "결정", "선택",
    "빛", "어둠", "색깔", "빨강", "파랑", "노랑", "초록", "검정", "하양", "소리",
    "냄새", "맛", "촉감", "온도", "질감",
    "운동", "축구", "야구", "농구", "수영", "달리기", "등산", "게임", "경기", "승리",
    "패배",
    "꿈", "용기", "인내", "노력", "성공", "실패", "변화", "성장", "발전", "혁신",
    "균형", "조화", "모험",
]


def compute_embedding_view(tokenizer, model, question: str, device: str) -> dict:
    """장식이 아니라 실제 모델의 임베딩 레이어에서 고정 기준 단어들 + 이번
    질문 문장의 단어 하나하나의 벡터를 뽑아, 같은 PCA로 함께 2차원에 투영한다
    (그래야 두 그룹이 같은 좌표계 안에서 비교된다). 여러 토큰으로 쪼개지는
    단어는 그 토큰들 임베딩의 평균을 쓴다."""
    embed_layer = model.get_input_embeddings()

    def word_vector(text: str) -> torch.Tensor:
        ids = tokenizer(text, add_special_tokens=False, return_tensors="pt")["input_ids"].to(device)
        with torch.no_grad():
            return embed_layer(ids)[0].mean(dim=0)

    my_words = question.split() or [question]
    ref_vectors = [word_vector(w) for w in REFERENCE_WORDS]
    my_vectors = [word_vector(w) for w in my_words]

    matrix = torch.stack(ref_vectors + my_vectors)
    centered = matrix - matrix.mean(dim=0, keepdim=True)
    _, _, v = torch.pca_lowrank(centered, q=2)
    coords = (centered @ v[:, :2]).tolist()

    scale = max((abs(x) for pt in coords for x in pt), default=1.0) or 1.0
    norm = [[x / scale, y / scale] for x, y in coords]

    n_ref = len(REFERENCE_WORDS)
    return {
        "words": [{"text": w, "x": x, "y": y} for w, (x, y) in zip(REFERENCE_WORDS, norm[:n_ref])],
        "myWords": [{"text": w, "x": x, "y": y} for w, (x, y) in zip(my_words, norm[n_ref:])],
    }


def compute_layer_view(model, prompt_ids) -> dict:
    """실제 24개 트랜스포머 레이어를 한 번 통과시키면서, 레이어마다 "셀프어텐션이
    한 일"과 "FFN(MLP)이 한 일"을 각각 얼마나 크게 바꿨는지(출력 벡터의 크기)를
    훅으로 붙잡는다 — 장식이 아니라 이 모델 안에서 실제로 계산되는 값이다.
    self_attn/mlp 서브모듈 출력을 직접 후킹하므로 Qwen2 계열의 내부 구조에
    의존한다."""
    captured = {"attn": [], "mlp": []}
    handles = []

    def make_hook(kind):
        def hook(_module, _inp, out):
            t = out[0] if isinstance(out, tuple) else out
            captured[kind].append(t[0, -1, :].detach())
        return hook

    layers = model.model.layers
    for layer in layers:
        handles.append(layer.self_attn.register_forward_hook(make_hook("attn")))
        handles.append(layer.mlp.register_forward_hook(make_hook("mlp")))
    try:
        with torch.no_grad():
            outputs = model(input_ids=prompt_ids, output_hidden_states=True, output_attentions=True)
    finally:
        for h in handles:
            h.remove()

    hidden_states = outputs.hidden_states  # (num_layers+1)개, 각 (batch, seq, hidden)
    attentions = outputs.attentions  # num_layers개, 각 (batch, heads, seq, seq)
    layer_data = []
    for i in range(len(layers)):
        before = hidden_states[i][0, -1, :]
        after = hidden_states[i + 1][0, -1, :]
        # 마지막 토큰 위치에서 각 헤드가 준 가장 강한 주목도(softmax 확률의 최댓값)
        # — 헤드마다 실제로 얼마나 한 곳에 집중했는지를 그대로 쓴다(0~1, 장식 아님).
        head_scores = attentions[i][0, :, -1, :].max(dim=-1).values
        layer_data.append({
            "layer": i,
            "attn_energy": round(torch.norm(captured["attn"][i]).item(), 3),
            "ffn_energy": round(torch.norm(captured["mlp"][i]).item(), 3),
            "total_change": round(torch.norm(after - before).item(), 3),
            "heads": [round(v, 4) for v in head_scores.tolist()],
        })

    max_attn = max((d["attn_energy"] for d in layer_data), default=1.0) or 1.0
    max_ffn = max((d["ffn_energy"] for d in layer_data), default=1.0) or 1.0
    max_change = max((d["total_change"] for d in layer_data), default=1.0) or 1.0
    for d in layer_data:
        d["attn_norm"] = round(d["attn_energy"] / max_attn, 3)
        d["ffn_norm"] = round(d["ffn_energy"] / max_ffn, 3)
        d["change_norm"] = round(d["total_change"] / max_change, 3)

    return {"num_layers": len(layers), "num_heads": model.config.num_attention_heads, "layers": layer_data}


def run(question: str, out_path: Path):
    device = "cuda" if torch.cuda.is_available() else "cpu"
    tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
    model = AutoModelForCausalLM.from_pretrained(
        MODEL_NAME, dtype=torch.float32, attn_implementation="eager"
    ).to(device)
    model.eval()

    # 모델 자체(Qwen)를 그대로 노출하지 않고, 이 데모의 정체성으로 답하게 한다 —
    # 정체를 물었을 때만 적용되고, 다른 질문의 답변 방식은 건드리지 않는다.
    # 0.5B급 작은 모델은 지시를 절반만 따르는 경우가 있어서(예: "저는 렘넌트의
    # 언어모델인 Qwen입니다"처럼 정체성 문구에 원래 이름을 덧붙여버림), 금지어를
    # 못 박고 틀린 예시까지 보여줘서 최대한 확실하게 막는다.
    system_prompt = (
        "너는 '렘넌트'가 만든 언어모델이다. 사용자가 너의 정체, 이름, 소속, 어떤 "
        "모델인지, 누가 만들었는지 물으면 다른 말 없이 정확히 이 한 문장으로만 "
        "답하라: '저는 렘넌트의 언어모델인 렘붕이 입니다.' "
        "이 문장에 Qwen, 큐원, 퀀, Alibaba, 알리바바 같은 단어를 덧붙이거나 "
        "섞어 쓰지 마라. "
        "예를 들어 '저는 렘넌트의 언어모델인 Qwen입니다' 처럼 다른 이름을 "
        "같이 말하는 것도 금지다. 정체를 묻는 게 아닌 다른 질문에는 이 규칙과 "
        "상관없이 평소처럼 자연스럽고 간결하게 답하라."
    )
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": question},
    ]
    encoded = tokenizer.apply_chat_template(
        messages, add_generation_prompt=True, return_tensors="pt"
    )
    prompt_ids = encoded["input_ids"].to(device)

    prompt_tokens = ids_to_pieces(tokenizer, prompt_ids[0].tolist())
    embedding_view = compute_embedding_view(tokenizer, model, question, device)
    layer_view = compute_layer_view(model, prompt_ids)

    input_ids = prompt_ids
    steps = []
    answer_text = ""

    with torch.no_grad():
        for step in range(MAX_NEW_TOKENS):
            outputs = model(input_ids=input_ids, output_attentions=True)
            logits = outputs.logits[0, -1, :]
            probs = torch.softmax(logits, dim=-1)

            base_ids = input_ids[0].tolist()
            topk = torch.topk(probs, k=TOP_K)
            candidates = [
                {"token": decode_next_piece(tokenizer, base_ids, idx), "prob": round(float(p), 4), "id": idx}
                for idx, p in zip(topk.indices.tolist(), topk.values.tolist())
            ]
            selected_id = topk.indices[0].item()
            selected_token = candidates[0]["token"]

            # 마지막 레이어, 전체 헤드 평균 어텐션에서
            # "새로 생성될 토큰 위치(-1)"가 이전 토큰들에 준 가중치를 뽑는다.
            last_layer_attn = outputs.attentions[-1][0]  # (heads, seq, seq)
            attn_from_last_token = last_layer_attn[:, -1, :].mean(dim=0)  # (seq,)
            attn_values = attn_from_last_token.tolist()

            all_tokens_so_far = ids_to_pieces(tokenizer, base_ids)
            attended = sorted(
                (
                    {"pos": pos, "token": tok, "weight": round(w, 4)}
                    for pos, (tok, w) in enumerate(zip(all_tokens_so_far, attn_values))
                ),
                key=lambda x: x["weight"],
                reverse=True,
            )[:ATTENDED_TOP_N]

            steps.append(
                {
                    "step": step,
                    "tokens_so_far": all_tokens_so_far,
                    "attended": attended,
                    "candidates": candidates,
                    "selected": selected_token,
                    "selected_id": selected_id,
                }
            )

            new_id = torch.tensor([[selected_id]], device=device)
            input_ids = torch.cat([input_ids, new_id], dim=1)
            answer_text += selected_token

            # 답변을 한 문장으로 제한한다 — 느낌표/물음표, 또는 문장을 끝내는
            # 마침표가 나오면 멈춘다. 다만 마침표 바로 앞이 숫자면(5.25 같은
            # 소수점/날짜 표현) 문장이 끝난 게 아니므로 계속 생성한다.
            stripped = answer_text.rstrip()
            is_sentence_end = bool(stripped) and (
                stripped[-1] in "!?"
                or (stripped[-1] == "." and (len(stripped) < 2 or not stripped[-2].isdigit()))
            )
            if selected_id == tokenizer.eos_token_id or is_sentence_end:
                break

    result = {
        "model": MODEL_NAME,
        "question": question,
        "prompt_tokens": prompt_tokens,
        "prompt_token_ids": prompt_ids[0].tolist(),
        "embedding": embedding_view,
        "layers": layer_view,
        "vocab_size": len(tokenizer),
        "steps": steps,
        "answer": tokenizer.decode(
            input_ids[0, prompt_ids.shape[1]:], skip_special_tokens=True
        ),
    }

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"saved {len(steps)} steps -> {out_path}")
    print("answer:", result["answer"])


if __name__ == "__main__":
    q = sys.argv[1] if len(sys.argv) > 1 else "고양이는 왜 그르릉 소리를 낼까?"
    run(q, Path(__file__).resolve().parent.parent / "frontend" / "data" / "sample_response.json")
