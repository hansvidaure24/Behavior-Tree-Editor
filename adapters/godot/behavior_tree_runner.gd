class_name BehaviorTreeRunner
extends Node

@export var json_path: String = ""

var bb: Blackboard = Blackboard.new()
var root: BTNode
var tree_title: String = ""

var _actions: Dictionary = {}
var _conditions: Dictionary = {}

func register_action(action_name: String, callable: Callable) -> void:
	_actions[action_name] = callable

func register_condition(condition_name: String, callable: Callable) -> void:
	_conditions[condition_name] = callable

func _ready() -> void:
	if json_path.is_empty():
		push_error("BehaviorTreeRunner: no json_path set")
		return
	var file := FileAccess.open(json_path, FileAccess.READ)
	if file == null:
		push_error("BehaviorTreeRunner: cannot open " + json_path)
		return
	var text := file.get_as_text()
	file.close()
	root = _load_from_json(text)

func _process(_delta: float) -> void:
	if root:
		root.tick(bb)

func _load_from_json(json_text: String) -> BTNode:
	var parsed = JSON.parse_string(json_text)
	if parsed == null:
		push_error("Failed to parse tree JSON")
		return null

	tree_title = parsed.get("title", "")
	var root_id: String = parsed.get("root", "")
	var nodes_dict: Dictionary = parsed.get("nodes", {})
	var built: Dictionary = {}

	for node_id in nodes_dict:
		var nd: Dictionary = nodes_dict[node_id]
		var type: String = nd.get("type", "")
		var node_name: String = nd.get("name", type)
		var params: Dictionary = nd.get("parameters", {})

		var node: BTNode
		match type:
			"sequence": node = SequenceNode.new()
			"selector": node = SelectorNode.new()
			"parallel": node = ParallelNode.new()
			"invert": node = InvertNode.new()
			"repeat": node = RepeatNode.new()
			"cooldown": node = CooldownNode.new()
			"timeout": node = TimeoutNode.new()
			"guard":
				var g := GuardNode.new()
				g.condition = _conditions.get(node_name, Callable())
				node = g
			"action":
				var a := ActionBTNode.new()
				a.execute = _actions.get(node_name, Callable())
				node = a
			"condition":
				var c := ConditionBTNode.new()
				c.check = _conditions.get(node_name, Callable())
				node = c
			_:
				node = ActionBTNode.new()

		node.id = node_id
		node.node_name = node_name
		node.parameters = params
		built[node_id] = node

	for node_id in nodes_dict:
		var nd: Dictionary = nodes_dict[node_id]
		var child_ids: Array = nd.get("children", [])
		for cid in child_ids:
			if built.has(cid):
				built[node_id].children.append(built[cid])

	return built.get(root_id, null)
