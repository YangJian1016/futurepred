from __future__ import annotations

from typing import Dict, List, Tuple


# Gender tag for each profession:
#   "female" — only assigned to female students
#   "male"   — only assigned to male students
#   "any"    — assigned to both genders (the vast majority)
#
# Classification rationale:
#   female-only : professions where a female image is strongly expected / the role is inherently
#                 female-associated (e.g. 妇产科医生, 空乘, 护士) or where presenting a boy
#                 would feel strange in a school ceremony context.
#   male-only   : physically male-typical roles (消防员, 应急救援员) or niche engineering roles
#                 added specifically to enrich the male pool.
#   any         : all other professions — fully gender-neutral, image generator handles gender
#                 via the gender_token in the prompt.
PROFESSION_GENDER: Dict[str, str] = {
    # ── STEM / AI / Robotics ──────────────────────────────────────────────────
    "AI应用工程师":           "any",
    "智能硬件工程师":         "any",
    "机器人研发工程师":       "any",
    "服务机器人训练师":       "any",
    "机器视觉工程师":         "any",
    "无人机飞控工程师":       "any",
    "低空飞行器工程师":       "any",
    "智能驾驶测试工程师":     "any",
    "车联网工程师":           "any",
    # ── Quantum / Future Tech (2040) ─────────────────────────────────────────
    "量子计算工程师":         "any",
    "脑机接口工程师":         "any",
    "数字孪生工程师":         "any",
    "AI伦理官":               "any",
    "纳米材料工程师":         "any",
    "虚拟现实导演":           "any",
    # ── Space / Deep Sea ─────────────────────────────────────────────────────
    "太空探索工程师":         "any",
    "深海探测科学家":         "any",
    # ── Energy / Environment ─────────────────────────────────────────────────
    "新能源工程师":           "any",
    "储能系统工程师":         "any",
    "智能电网工程师":         "any",
    "碳管理工程师":           "any",
    "环保工程师":             "any",
    # ── Agriculture / Life Science ───────────────────────────────────────────
    "智慧农业工程师":         "any",
    "兽医":                   "any",
    "海洋生物研究员":         "any",
    # ── Medical / Health ─────────────────────────────────────────────────────
    "儿科医生":               "any",
    "牙医":                   "any",
    "护士":                   "female",
    "药剂师":                 "any",
    "康复治疗师":             "any",
    "心理咨询师":             "any",
    "营养师":                 "any",
    "妇产科医生":             "female",
    # ── Biotech / Bioprinting / Materials ────────────────────────────────────
    "生物工程师":             "any",
    "基因检测工程师":         "any",
    "药物研发工程师":         "any",
    "生物3D打印工程师":       "any",
    "材料工程师":             "any",
    "化学工程师":             "any",
    "应急救援员":             "male",
    # ── Software / Internet ───────────────────────────────────────────────────
    "前端工程师":             "any",
    "后端工程师":             "any",
    "全栈工程师":             "any",
    "云平台工程师":           "any",
    "网络安全工程师":         "any",
    "数据分析师":             "any",
    "数据产品经理":           "any",
    "AI产品经理":             "any",
    # ── Design / Creative ────────────────────────────────────────────────────
    "UI设计师":               "any",
    "用户体验设计师":         "any",
    "数字内容设计师":         "any",
    "动画设计师":             "any",
    "游戏策划师":             "any",
    "数字媒体导演":           "any",
    "摄影师":                 "any",
    "视频创作师":             "any",
    "音乐制作人":             "any",
    "作曲家":                 "any",
    "主持人":                 "any",
    "科学传播师":             "any",
    "时尚品牌策划师":         "female",
    # ── Education ────────────────────────────────────────────────────────────
    "科学老师":               "any",
    "编程老师":               "any",
    "机器人课程导师":         "any",
    "数学老师":               "any",
    "语文老师":               "any",
    "英语老师":               "any",
    "体育老师":               "any",
    "美术老师":               "any",
    "心理老师":               "any",
    "教育技术顾问":           "any",
    "国际课程导师":           "any",
    # ── Architecture / Civil / Smart City ────────────────────────────────────
    "建筑师":                 "any",
    "室内设计师":             "any",
    "景观设计师":             "any",
    "建筑数字化工程师":       "any",
    "智慧城市工程师":         "any",
    "土木工程师":             "any",
    # ── Mechanical / Electrical / Manufacturing ───────────────────────────────
    "机械工程师":             "any",
    "电气工程师":             "any",
    "电子工程师":             "any",
    "工业自动化工程师":       "any",
    "智能制造工程师":         "any",
    "智能制造系统工程师":     "male",
    "航空维修工程师":         "male",
    "基础设施安全工程师":     "male",
    # ── Aviation / Transportation ────────────────────────────────────────────
    "航空工程师":             "any",
    "飞行员":                 "any",
    "船舶工程师":             "any",
    "空乘":                   "female",
    # ── Business / Commerce / Finance ────────────────────────────────────────
    "跨境贸易经理":           "any",
    "品牌策划师":             "any",
    "市场分析师":             "any",
    "理财顾问":               "any",
    "公共关系顾问":           "any",
    # ── Legal / Public Safety ─────────────────────────────────────────────────
    "法官":                   "any",
    "检察官":                 "any",
    "律师":                   "any",
    "警察":                   "any",
    "消防员":                 "male",
    # ── Languages / International ─────────────────────────────────────────────
    "同声传译员":             "any",
    "国际组织项目官员":       "any",
    # ── Culture / Sports ─────────────────────────────────────────────────────
    "文物修复师":             "any",
    "体育教练":               "any",
    "运动康复师":             "any",
    # ── Child / Psychology ────────────────────────────────────────────────────
    "儿童发展评估师":         "female",
    # ── New Cross-Domain Expansion (2026-2040) ───────────────────────────────
    "AI模型设计师":           "any",
    "多媒体AI工程师":         "any",
    "智能设备AI工程师":       "any",
    "智能机器人工程师":       "any",
    "人形机器人系统工程师":   "any",
    "自动驾驶测试工程师":     "any",
    "卫星观测工程师":         "any",
    "卫星通信工程师":         "any",
    "未来能源工程师":         "any",
    "氢能系统工程师":         "any",
    "海上风电工程师":         "any",
    "碳减排工程师":           "any",
    "气候安全分析师":         "any",
    "生物科技工程师":         "any",
    "生物分子工程师":         "any",
    "再生医疗工程师":         "any",
    "医疗数据科学家":         "any",
    "医疗机器人工程师":       "any",
    "临床数据经理":           "any",
    "医学影像分析工程师":     "any",
    "数据隐私工程师":         "any",
    "数字合规工程师":         "any",
    "AI部署工程师":           "any",
    "AI提示词设计师":         "any",
    "AI内容策划师":           "any",
    "工业设计师":             "any",
    "用户服务设计师":         "any",
    "数字人设计师":           "any",
    "影视色彩设计师":         "any",
    "舞台灯光设计师":         "any",
    "科技记者":               "any",
    "学习成长顾问":           "any",
    "特殊教育教师":           "any",
    "职业规划导师":           "any",
    "城市规划师":             "any",
    "抗震结构工程师":         "any",
    "建筑信息工程师":         "any",
    "智慧交通工程师":         "any",
    "轨道信号工程师":         "any",
    "航天计划师":             "any",
    "月球基地工程师":         "any",
    "太空服务工程师":         "any",
    "深空通讯工程师":         "any",
    "供应链安全经理":         "any",
    "国际财税顾问":           "any",
    "可持续发展分析师":       "any",
    "规则合规官":             "any",
    "知识产权律师":           "any",
    "助产士":                 "female",
    "特勤救援队员":           "male",
}


def _deduplicate(items: List[str]) -> List[str]:
    seen = set()
    ordered: List[str] = []
    for item in items:
        if item in seen:
            continue
        seen.add(item)
        ordered.append(item)
    return ordered


def get_professions_for_gender(gender: str) -> List[str]:
    """Return the profession list for the given gender.

    female → female-tagged + any-tagged professions
    male   → male-tagged  + any-tagged professions
    other  → all professions (used as fallback / for admin stats)
    """
    normalized = (gender or "").strip().lower()
    if normalized == "female":
        return [p for p, g in PROFESSION_GENDER.items() if g in ("female", "any")]
    if normalized == "male":
        return [p for p, g in PROFESSION_GENDER.items() if g in ("male", "any")]
    return list(PROFESSION_GENDER.keys())


PROFESSION_EN_MAP = {
    "AI应用工程师": "AI Application Engineer",
    "智能硬件工程师": "Intelligent Hardware Engineer",
    "机器人研发工程师": "Robotics R&D Engineer",
    "服务机器人训练师": "Service Robot Trainer",
    "机器视觉工程师": "Machine Vision Engineer",
    "无人机飞控工程师": "UAV Flight Control Engineer",
    "低空飞行器工程师": "Low-Altitude Aircraft Engineer",
    "智能驾驶测试工程师": "Autonomous Driving Test Engineer",
    "车联网工程师": "Vehicle Networking Engineer",
    "新能源工程师": "New Energy Engineer",
    "储能系统工程师": "Energy Storage Systems Engineer",
    "智能电网工程师": "Smart Grid Engineer",
    "碳管理工程师": "Carbon Management Engineer",
    "环保工程师": "Environmental Engineer",
    "智慧农业工程师": "Smart Agriculture Engineer",
    "农艺师": "Agronomist",
    "园艺师": "Horticulturist",
    "兽医": "Veterinarian",
    "海洋生物研究员": "Marine Biology Researcher",
    "气象预报员": "Meteorologist",
    "医生": "Doctor",
    "儿科医生": "Pediatrician",
    "牙医": "Dentist",
    "护士": "Nurse",
    "药剂师": "Pharmacist",
    "康复治疗师": "Rehabilitation Therapist",
    "心理咨询师": "Psychological Counselor",
    "营养师": "Nutritionist",
    "医学影像技师": "Medical Imaging Technologist",
    "公共卫生管理师": "Public Health Manager",
    "生物工程师": "Bioengineer",
    "基因检测工程师": "Genetic Testing Engineer",
    "药物研发工程师": "Drug R&D Engineer",
    "食品工程师": "Food Engineer",
    "食品安全检测师": "Food Safety Inspector",
    "材料工程师": "Materials Engineer",
    "化学工程师": "Chemical Engineer",
    "质量工程师": "Quality Engineer",
    "安全工程师": "Safety Engineer",
    "应急救援员": "Emergency Responder",
    "程序员": "Programmer",
    "前端工程师": "Frontend Engineer",
    "后端工程师": "Backend Engineer",
    "全栈工程师": "Full-Stack Engineer",
    "软件测试工程师": "Software Test Engineer",
    "云平台工程师": "Cloud Platform Engineer",
    "网络安全工程师": "Cybersecurity Engineer",
    "数据分析师": "Data Analyst",
    "数据产品经理": "Data Product Manager",
    "AI产品经理": "AI Product Manager",
    "UI设计师": "UI Designer",
    "交互设计师": "Interaction Designer",
    "数字内容设计师": "Digital Content Designer",
    "动画设计师": "Animation Designer",
    "游戏策划师": "Game Planner",
    "数字媒体导演": "Digital Media Director",
    "摄影师": "Photographer",
    "视频创作师": "Video Creator",
    "音乐制作人": "Music Producer",
    "作曲家": "Composer",
    "主持人": "Host",
    "科学传播师": "Science Communicator",
    "教师": "Teacher",
    "科学老师": "Science Teacher",
    "编程老师": "Programming Teacher",
    "机器人课程导师": "Robotics Course Instructor",
    "数学老师": "Math Teacher",
    "语文老师": "Chinese Teacher",
    "英语老师": "English Teacher",
    "体育老师": "PE Teacher",
    "美术老师": "Art Teacher",
    "心理老师": "School Counselor",
    "图书馆管理员": "Librarian",
    "教育技术顾问": "EdTech Consultant",
    "建筑师": "Architect",
    "室内设计师": "Interior Designer",
    "景观设计师": "Landscape Designer",
    "建筑数字化工程师": "Building Digitalization Engineer",
    "智慧城市工程师": "Smart City Engineer",
    "土木工程师": "Civil Engineer",
    "机械工程师": "Mechanical Engineer",
    "电气工程师": "Electrical Engineer",
    "电子工程师": "Electronics Engineer",
    "工业自动化工程师": "Industrial Automation Engineer",
    "智能制造工程师": "Intelligent Manufacturing Engineer",
    "航空工程师": "Aerospace Engineer",
    "飞行员": "Pilot",
    "高铁司机": "High-Speed Rail Driver",
    "地铁调度员": "Metro Dispatcher",
    "船舶工程师": "Naval Engineer",
    "物流系统工程师": "Logistics Systems Engineer",
    "供应链分析师": "Supply Chain Analyst",
    "电商运营经理": "E-commerce Operations Manager",
    "跨境贸易经理": "Cross-border Trade Manager",
    "会展策划师": "Exhibition Planner",
    "酒店运营经理": "Hotel Operations Manager",
    "导游": "Tour Guide",
    "品牌策划师": "Brand Strategist",
    "市场分析师": "Market Analyst",
    "客户成功经理": "Customer Success Manager",
    "会计": "Accountant",
    "审计师": "Auditor",
    "理财顾问": "Financial Advisor",
    "保险顾问": "Insurance Advisor",
    "人力资源经理": "HR Manager",
    "法官": "Judge",
    "检察官": "Prosecutor",
    "律师": "Lawyer",
    "知识产权顾问": "IP Consultant",
    "警察": "Police Officer",
    "消防员": "Firefighter",
    "交警": "Traffic Police Officer",
    "翻译": "Translator",
    "同声传译员": "Simultaneous Interpreter",
    "国际交流项目官员": "International Exchange Program Officer",
    "公益项目经理": "Public Welfare Project Manager",
    "社区工作者": "Community Worker",
    "博物馆讲解员": "Museum Docent",
    "文物修复师": "Cultural Relics Conservator",
    "体育教练": "Sports Coach",
    "体能训练师": "Fitness Trainer",
    "运动康复师": "Sports Rehabilitation Specialist",
    "妇产科医生": "Obstetrician and Gynecologist",
    "空乘": "Flight Attendant",
    "儿童发展评估师": "Child Development Assessor",
    "青少年心理咨询师": "Adolescent Psychological Counselor",
    "国际课程导师": "International Curriculum Instructor",
    "用户体验设计师": "User Experience Designer",
    "品牌视觉设计师": "Brand Visual Designer",
    "数字产品交互设计师": "Digital Product Interaction Designer",
    "时尚品牌策划师": "Fashion Brand Strategist",
    "公共关系顾问": "Public Relations Consultant",
    "科学教育传播官": "Science Education Communication Officer",
    "国际组织项目官员": "International Organization Program Officer",
    "基础设施安全工程师": "Infrastructure Safety Engineer",
    "航空维修工程师": "Aviation Maintenance Engineer",
    "智能制造系统工程师": "Intelligent Manufacturing Systems Engineer",
    # 2040 future professions
    "量子计算工程师": "Quantum Computing Engineer",
    "脑机接口工程师": "Brain-Computer Interface Engineer",
    "数字孪生工程师": "Digital Twin Engineer",
    "AI伦理官": "AI Ethics Officer",
    "纳米材料工程师": "Nanomaterials Engineer",
    "虚拟现实导演": "Virtual Reality Director",
    "太空探索工程师": "Space Exploration Engineer",
    "深海探测科学家": "Deep-Sea Exploration Scientist",
    "生物3D打印工程师": "Bio-3D Printing Engineer",
    # Cross-domain expansion professions
    "AI模型设计师": "AI Model Architect",
    "多媒体AI工程师": "Multimodal Algorithm Engineer",
    "智能设备AI工程师": "Edge AI Engineer",
    "智能机器人工程师": "Embodied AI Engineer",
    "人形机器人系统工程师": "Humanoid Robotics Systems Engineer",
    "自动驾驶测试工程师": "Autonomous Driving Simulation Engineer",
    "卫星观测工程师": "Satellite Remote Sensing Engineer",
    "卫星通信工程师": "Low Earth Orbit Communications Engineer",
    "未来能源工程师": "Fusion Systems Engineer",
    "氢能系统工程师": "Hydrogen Energy Systems Engineer",
    "海上风电工程师": "Offshore Wind Power Engineer",
    "碳减排工程师": "Carbon Capture Engineer",
    "气候安全分析师": "Climate Risk Analyst",
    "生物科技工程师": "Synthetic Biology Engineer",
    "生物分子工程师": "Protein Engineer",
    "再生医疗工程师": "Regenerative Medicine Engineer",
    "医疗数据科学家": "Precision Medicine Data Scientist",
    "医疗机器人工程师": "Medical Robotic Surgery Engineer",
    "临床数据经理": "Clinical Data Manager",
    "医学影像分析工程师": "Digital Pathology Engineer",
    "数据隐私工程师": "Privacy Computing Engineer",
    "数字合规工程师": "Blockchain Compliance Engineer",
    "AI部署工程师": "MLOps Engineer",
    "AI提示词设计师": "Prompt Engineer",
    "AI内容策划师": "AIGC Content Strategist",
    "工业设计师": "Industrial Designer",
    "用户服务设计师": "Service Designer",
    "数字人设计师": "Virtual Human Designer",
    "影视色彩设计师": "Colorist",
    "舞台灯光设计师": "Stage Lighting Designer",
    "科技记者": "Technology Journalist",
    "学习成长顾问": "Learning Science Consultant",
    "特殊教育教师": "Special Education Teacher",
    "职业规划导师": "Career Planning Mentor",
    "城市规划师": "Urban Renewal Planner",
    "抗震结构工程师": "Seismic Structural Engineer",
    "建筑信息工程师": "BIM Engineer",
    "智慧交通工程师": "Smart Transportation Engineer",
    "轨道信号工程师": "Rail Transit Signaling Engineer",
    "航天计划师": "Space Mission Planner",
    "月球基地工程师": "Lunar Base Operations Engineer",
    "太空服务工程师": "Near-Earth Orbit Service Engineer",
    "深空通讯工程师": "Deep Space Communications Engineer",
    "供应链安全经理": "Supply Chain Risk Control Manager",
    "国际财税顾问": "International Tax Advisor",
    "可持续发展分析师": "ESG Analyst",
    "规则合规官": "Compliance Officer",
    "知识产权律师": "Intellectual Property Lawyer",
    "助产士": "Midwife",
    "特勤救援队员": "Special Rescue Officer",
}


def get_profession_english_label(profession_zh: str) -> str:
    # Fallback to the original label if no translation is configured.
    return PROFESSION_EN_MAP.get(profession_zh, profession_zh)


DEFAULT_SCENE_PROMPT = (
    "in a rich professional workplace background with clear job-related props and contextual environment, portrait-focused composition, clean key light on face, shallow depth of field, and sharp facial details"
)

FACE_CLARITY_SUFFIX = (
    "portrait-focused composition, clean key light on face, shallow depth of field, and sharp facial details"
)

SCENE_HINT_RULES: List[Tuple[Tuple[str, ...], str]] = [
    (("医生", "护士", "药剂", "影像", "康复", "儿科", "牙医", "生物3d打印"), "in a modern hospital or clinic setting, with medical instruments and diagnostic monitors"),
    (("教师", "老师", "导师", "教育", "图书馆"), "in a vibrant classroom or learning lab, with smart board, books, and educational tools"),
    (("量子计算",), "in a cutting-edge quantum computing laboratory, with quantum processors, cryogenic cooling chambers, and holographic data displays"),
    (("脑机接口",), "in a neurotechnology research lab, with brain-scan headsets, neural signal monitors, and advanced computing interfaces"),
    (("数字孪生",), "in a futuristic digital twin control center, with 3D holographic city models, real-time sensor dashboards, and simulation consoles"),
    (("ai伦理",), "in a modern AI governance office, with ethics review dashboards, policy documents, and multi-screen AI system monitors"),
    (("纳米材料",), "in a high-tech nanotechnology laboratory, with electron microscopes, cleanroom suits, and molecular structure displays"),
    (("虚拟现实导演", "虚拟现实"), "in a futuristic VR production studio, with motion-capture rigs, holographic sets, and immersive headset arrays"),
    (("太空探索",), "in a space mission control center or astronaut training facility, with rocket models, star maps, space suits, and mission screens"),
    (("深海探测",), "in a deep-sea research vessel or underwater lab, with submersible vehicles, sonar equipment, and ocean specimen displays"),
    (("程序", "前端", "后端", "全栈", "软件", "ai", "数据", "网络安全", "云平台"), "in a futuristic technology workspace, with multi-screen dashboards, code interfaces, and development equipment"),
    (("机器人", "智能硬件", "机器视觉", "自动化", "制造", "机械", "电气", "电子"), "inside an advanced robotics or smart manufacturing lab, with robotic arms, control consoles, and engineering devices"),
    (("建筑", "室内", "景观", "土木", "城市"), "at an architectural studio or construction planning space, with blueprints, models, and city-design elements"),
    (("飞行", "航空", "无人机", "高铁", "地铁", "船舶", "物流"), "in a high-tech transportation environment, with cockpit controls, vehicles, and operation equipment"),
    (("警察", "消防", "法官", "检察", "律师", "应急"), "in a professional public-service environment, with clear duty-related equipment and workplace context"),
    (("摄影", "视频", "动画", "媒体", "导演", "音乐", "作曲", "主持"), "in a creative production studio, with cameras, lights, audio gear, and artistic set design"),
    (("农业", "农艺", "园艺", "海洋", "气象", "环保", "碳管理"), "in a field-research environment, with scientific instruments, natural elements, and domain facilities"),
    (("会计", "审计", "理财", "保险", "品牌", "市场", "运营", "供应链", "贸易"), "in a modern business environment, with data walls, meeting space, and profession-specific tools"),
    (("运动", "体育", "体能"), "in a professional training venue, with sports equipment and performance tracking systems"),
    # Misc specific-role catch-all groups
    (("智能驾驶", "自动驾驶", "车联网"), "in a state-of-the-art autonomous vehicle testing center, with sensor arrays, AI dashboards, and smart road simulations"),
    (("新能源", "储能", "智能电网"), "in a clean-energy facility, with solar panels, battery storage walls, smart grid monitors, and sustainable tech equipment"),
    (("兽医",), "in a well-equipped veterinary clinic, with animal examination tables, medical devices, and caring professional environment"),
    (("心理咨询师", "心理老师"), "in a calm and professional counseling office, with comfortable seating, warm lighting, and wellness decor"),
    (("营养师",), "in a modern nutrition consultation office, with health charts, food models, and wellness assessment tools"),
    (("生物工程师", "基因检测", "药物研发", "材料工程师", "化学工程师"), "in a high-tech biotech or chemical research laboratory, with advanced instruments, microscopes, and scientific equipment"),
    (("ui设计师", "用户体验设计师", "数字内容设计师"), "in a sleek digital design studio, with large creative monitors, design tablets, and colorful user interface mockups"),
    (("游戏策划",), "in a vibrant game studio, with concept art walls, gaming PCs, and playtest setups"),
    (("科学传播",), "in a dynamic science communication studio, with interactive displays, lab props, and broadcast-quality lighting"),
    (("基础设施安全",), "in a critical infrastructure monitoring center, with security consoles, network maps, and engineering equipment"),
    (("空乘",), "in a premium airline cabin or airport terminal, with professional flight attendant uniform and aviation service context"),
    (("公共关系",), "in a modern corporate PR office, with media screens, press materials, and professional communication setup"),
    (("同声传译",), "in a high-level international conference hall, with simultaneous interpretation booth, headsets, and multi-language delegates"),
    (("国际组织",), "in an international organization office, with world map, flags of nations, and global cooperation documents"),
    (("文物修复",), "in a cultural heritage conservation studio, with ancient artifacts, specialized restoration tools, and museum-quality lighting"),
    (("儿童发展",), "in a professional child development center, with age-appropriate play materials, assessment tools, and warm caring environment"),
    (("算法", "ai模型", "多媒体ai", "智能设备ai", "mlops", "ai部署", "提示词", "aigc", "ai内容"), "in a cutting-edge AI engineering workspace, with model dashboards, evaluation panels, and advanced compute terminals"),
    (("人形机器人", "机器人手术", "自动驾驶仿真"), "in a high-fidelity robotics simulation lab, with robotic platforms, control rigs, and real-time telemetry systems"),
    (("卫星观测", "卫星通信", "航天计划", "月球基地", "太空服务", "深空通讯"), "in an aerospace mission operations center, with orbital maps, satellite telemetry walls, and mission planning consoles"),
    (("未来能源", "氢能", "海上风电", "碳减排", "可持续发展", "气候安全"), "in a future-focused energy and climate operations hub, with sustainability dashboards, grid simulations, and engineering control systems"),
    (("生物科技", "生物分子", "再生医疗", "医疗数据", "医学影像分析", "临床数据"), "in an advanced precision-medicine laboratory, with biomedical analysis stations, clinical data terminals, and molecular research equipment"),
    (("数据隐私", "数字合规", "规则合规", "知识产权律师", "国际财税"), "in a secure compliance and legal strategy office, with policy documentation, encrypted data screens, and consultation workstations"),
    (("工业设计", "用户服务设计", "数字人设计", "影视色彩", "舞台灯光"), "in a premium creative design studio, with concept boards, calibrated displays, and professional production tools"),
    (("科技记者",), "in a modern technology newsroom, with editorial screens, interview setup, and live reporting equipment"),
    (("学习成长", "特殊教育", "职业规划"), "in an educational innovation center, with learner analytics boards, guidance materials, and interactive mentoring spaces"),
    (("城市规划", "抗震结构", "建筑信息", "智慧交通", "轨道信号"), "in an urban infrastructure planning center, with digital twin city models, engineering schematics, and transit control maps"),
    (("供应链安全",), "in a global supply-chain risk command room, with logistics maps, risk heatmaps, and operations dashboards"),
    (("助产士",), "in a modern maternity care center, with prenatal monitoring equipment and a calm supportive clinical environment"),
    (("特勤救援",), "in an emergency tactical response center, with rescue coordination systems and mission-ready safety equipment"),
]


DEFAULT_SHOT_TEMPLATE = (
    "half-body portrait, eye-level camera, 50mm lens perspective, centered framing, face occupying about one-third of the image"
)

SHOT_TEMPLATE_RULES: List[Tuple[Tuple[str, ...], str]] = [
    (("医生", "护士", "药剂", "康复", "儿科", "牙医", "助产士", "心理咨询", "营养", "病理", "临床", "医疗数据"), "medium close-up portrait, eye-level camera, 85mm lens perspective, face occupying about 40% of frame"),
    (("工程师", "研发", "制造", "机械", "电气", "电子", "机器人", "bim", "结构"), "half-body portrait, slight 10-degree angle, 50mm lens perspective, face occupying about 35% of frame"),
    (("主持", "记者", "传播", "导演", "摄影", "视频", "动画", "音乐", "作曲", "调色", "灯光"), "chest-up portrait, eye-level camera, 70mm lens perspective, face occupying about 45% of frame"),
    (("法官", "检察", "律师", "警察", "消防", "应急", "特勤"), "medium shot portrait, eye-level camera, 50mm lens perspective, face occupying about 35% of frame"),
    (("老师", "导师", "教育", "顾问", "评估师"), "medium close-up portrait, eye-level camera, 65mm lens perspective, face occupying about 40% of frame"),
    (("飞行", "航空", "航天", "太空", "深空", "轨道", "船舶", "空乘"), "half-body portrait, low-angle by 5 degrees, 50mm lens perspective, face occupying about 33% of frame"),
    (("市场", "品牌", "贸易", "理财", "税务", "财税", "合规", "esg", "可持续", "风控", "供应链安全", "风险", "分析师", "产品经理"), "medium shot portrait, eye-level camera, 55mm lens perspective, face occupying about 36% of frame"),
    (("设计师", "策划", "虚拟人", "ui", "体验"), "chest-up portrait, eye-level camera, 75mm lens perspective, face occupying about 42% of frame"),
    (("建筑", "城市更新", "规划"), "half-body portrait, eye-level camera, 55mm lens perspective, face occupying about 36% of frame"),
    (("兽医", "海洋生物", "深海探测", "科学家"), "medium shot portrait, eye-level camera, 60mm lens perspective, face occupying about 37% of frame"),
    (("同声传译", "国际组织"), "chest-up portrait, eye-level camera, 70mm lens perspective, face occupying about 42% of frame"),
    (("文物修复",), "medium close-up portrait, eye-level camera, 75mm lens perspective, face occupying about 40% of frame"),
    (("体育教练",), "medium shot portrait, eye-level camera, 50mm lens perspective, face occupying about 36% of frame"),
    (("ai",), "half-body portrait, eye-level camera, 50mm lens perspective, face occupying about 36% of frame"),
]


def get_profession_scene_hint(profession_zh: str) -> str:
    label = (profession_zh or "").lower()
    for keywords, hint in SCENE_HINT_RULES:
        if any(keyword in label for keyword in keywords):
            if FACE_CLARITY_SUFFIX.lower() in hint.lower():
                return hint
            return f"{hint}, {FACE_CLARITY_SUFFIX}"
    return DEFAULT_SCENE_PROMPT


def get_profession_shot_template(profession_zh: str) -> str:
    label = (profession_zh or "").lower()
    for keywords, template in SHOT_TEMPLATE_RULES:
        if any(keyword in label for keyword in keywords):
            return template
    return DEFAULT_SHOT_TEMPLATE


def get_profession_prompt_profile(profession_zh: str) -> Dict[str, str]:
    # Unified bilingual structure used by prompt builders.
    return {
        "zh": profession_zh,
        "en": get_profession_english_label(profession_zh),
        "scene": get_profession_scene_hint(profession_zh),
        "shot": get_profession_shot_template(profession_zh),
    }


def get_professions_missing_english_labels() -> List[str]:
    return [profession for profession in ALL_PROFESSIONS if profession not in PROFESSION_EN_MAP]


def get_professions_using_default_scene() -> List[str]:
    return [profession for profession in ALL_PROFESSIONS if get_profession_scene_hint(profession) == DEFAULT_SCENE_PROMPT]


def get_professions_using_default_shot_template() -> List[str]:
    return [profession for profession in ALL_PROFESSIONS if get_profession_shot_template(profession) == DEFAULT_SHOT_TEMPLATE]


ALL_PROFESSIONS = list(PROFESSION_GENDER.keys())
PROFESSION_PROMPT_PROFILES = {
    profession: get_profession_prompt_profile(profession)
    for profession in ALL_PROFESSIONS
}


# Backward-compatible export (returns all professions when gender is unknown).
HIGH_END_PROFESSIONS = get_professions_for_gender("unknown")
