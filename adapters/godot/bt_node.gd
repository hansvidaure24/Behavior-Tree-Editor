class_name BTNode
extends RefCounted

enum Status { SUCCESS, FAILURE, RUNNING }

var id: String
var node_name: String
var parameters: Dictionary = {}
var children: Array[BTNode] = []
var last_status: Status = Status.FAILURE

func tick(bb: Blackboard) -> Status:
	last_status = _on_tick(bb)
	return last_status

func _on_tick(_bb: Blackboard) -> Status:
	return Status.FAILURE
